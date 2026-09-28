import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { workweekStart } from '../src/modules/payroll/payroll-calc.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
};
type Auth = { Authorization: string };
type Staff = { auth: Auth; userId: string; staffId: string };

describe.skipIf(!hasDb)('Payroll (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let patientId: string;
  let admin: Auth;
  let hourlyAide: Staff;
  let visitNurse: Staff;
  let noRateAide: Staff;
  const http = () => request(app.getHttpServer());
  // Two full workweeks (Sunday start) that ended at least a few days ago.
  const periodStart = workweekStart(addDays(utcTodayString(), -21), 0);
  const periodEnd = addDays(periodStart, 13);
  const base = '/api/v1/payroll';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(noThrottle)
      .compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Payroll Test ${randomUUID()}`, timezone: 'UTC', payrollMileageRate: 0.7 } })).id;
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Paula', lastName: 'Patient', dateOfBirth: new Date('1940-01-01T00:00:00Z'), status: 'active' },
      })
    ).id;
    admin = (await seedUser('agency_admin', null)).auth;
    hourlyAide = await seedUser('home_health_aide', { discipline: 'HHA', hourlyRate: 20, employeeId: 'E100' });
    visitNurse = await seedUser('registered_nurse', { discipline: 'RN', perVisitRate: 50, hourlyRate: 45, employeeId: 'E200' });
    noRateAide = await seedUser('home_health_aide', { discipline: 'HHA', employeeId: 'E300' });

    // Aide: five 9-hour days in week 1 (45 h → 5 h overtime), one 4-hour day in week 2, one unverified visit.
    for (let d = 1; d <= 5; d++) await visit(hourlyAide.staffId, addDays(periodStart, d), 9);
    await visit(hourlyAide.staffId, addDays(periodStart, 8), 4);
    await visit(hourlyAide.staffId, addDays(periodStart, 9), 2, 'completed'); // EVV not verified yet
    // The week before the period doesn't count (a different workweek).
    await visit(hourlyAide.staffId, addDays(periodStart, -1), 10);
    await visit(visitNurse.staffId, addDays(periodStart, 2), 1);
    await visit(visitNurse.staffId, addDays(periodStart, 10), 1.5);
    await visit(noRateAide.staffId, addDays(periodStart, 3), 3);
  });

  afterAll(async () => {
    await prisma.payPeriod.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await prisma.evvRecord.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.auditLog.deleteMany({ where: { agencyId } });
    await prisma.user.deleteMany({ where: { agencyId } }); // staff profiles, mileage cascade
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, profile: { discipline: string; hourlyRate?: number; perVisitRate?: number; employeeId: string } | null): Promise<Staff> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `pay-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Pat',
        lastName: `${roleName}-${profile?.employeeId ?? 'admin'}`,
        userRoles: { create: { roleId: role.id } },
        ...(profile ? { staffProfile: { create: { agencyId, ...profile } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { userId: user.id, staffId: user.staffProfile?.id ?? '', auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  async function visit(staffId: string, date: string, hours: number, evvStatus = 'verified') {
    const start = new Date(`${date}T08:00:00Z`);
    const end = new Date(start.getTime() + hours * 3_600_000);
    const v = await prisma.visit.create({
      data: {
        agencyId, patientId, staffId, visitType: 'home_health_aide', status: 'completed',
        scheduledDate: toDate(date)!, scheduledStart: toTime('08:00'), scheduledEnd: toTime('17:00'), actualStart: start, actualEnd: end,
      },
    });
    await prisma.evvRecord.create({
      data: { visitId: v.id, agencyId, staffId, patientId, serviceType: 'home_health_aide', serviceDate: toDate(date)!, clockInMethod: 'gps', clockInTime: start, clockOutTime: end, status: evvStatus },
    });
  }

  let periodId: string;

  it('creates non-overlapping pay periods', async () => {
    await http().post(`${base}/pay-periods`).set(hourlyAide.auth).send({ periodStart, periodEnd, payDate: addDays(periodEnd, 5) }).expect(403);
    await http().post(`${base}/pay-periods`).set(admin).send({ periodStart, periodEnd: addDays(periodStart, -1), payDate: periodEnd }).expect(400);
    const res = await http().post(`${base}/pay-periods`).set(admin).send({ periodStart, periodEnd, payDate: addDays(periodEnd, 5) }).expect(201);
    periodId = res.body.data.id;
    expect(res.body.data).toMatchObject({ status: 'open', periodStart, periodEnd });
    await http().post(`${base}/pay-periods`).set(admin).send({ periodStart: addDays(periodStart, 7), periodEnd: addDays(periodEnd, 7), payDate: addDays(periodEnd, 12) }).expect(409);
  });

  it('staff log their own mileage; payroll approves it', async () => {
    const mine = (await http().post(`${base}/mileage`).set(hourlyAide.auth).send({ travelDate: addDays(periodStart, 2), miles: 10, description: 'Office to client' }).expect(201)).body.data;
    expect(mine).toMatchObject({ status: 'pending', miles: 10, staff: { id: hourlyAide.staffId } });
    await http().post(`${base}/mileage`).set(hourlyAide.auth).send({ travelDate: addDays(periodStart, 2), miles: 5, staffId: visitNurse.staffId }).expect(403);
    await http().patch(`${base}/mileage/${mine.id}`).set(hourlyAide.auth).send({ decision: 'approved' }).expect(403);
    const others = (await http().get(`${base}/mileage`).set(visitNurse.auth).expect(200)).body.data;
    expect(others).toEqual([]); // only their own
    await http().patch(`${base}/mileage/${mine.id}`).set(admin).send({ decision: 'rejected' }).expect(400); // needs a reason
    await http().patch(`${base}/mileage/${mine.id}`).set(admin).send({ decision: 'approved' }).expect(200);
    await http().patch(`${base}/mileage/${mine.id}`).set(admin).send({ decision: 'approved' }).expect(409);
  });

  it('calculates hourly pay with workweek overtime, per-visit pay, mileage — and warns about what it could not pay', async () => {
    const res = (await http().post(`${base}/pay-periods/${periodId}/calculate`).set(admin).expect(200)).body.data;
    expect(res.status).toBe('calculated');
    const aide = res.stubs.find((s: { staff: { id: string } }) => s.staff.id === hourlyAide.staffId);
    expect(aide).toMatchObject({ regularHours: 44, overtimeHours: 5, visitCount: 6, regularPay: 880, overtimePay: 150, mileageMiles: 10, mileageAmount: 7, grossPay: 1030 });
    expect(aide.lines.find((l: { payType: string }) => l.payType === 'overtime')).toMatchObject({ hours: 5, rate: 30, amount: 150, patientLabel: 'Paula P.' });
    const nurse = res.stubs.find((s: { staff: { id: string } }) => s.staff.id === visitNurse.staffId);
    expect(nurse).toMatchObject({ visitCount: 2, perVisitPay: 100, regularPay: 0, grossPay: 100 });
    expect(res.stubs.some((s: { staff: { id: string } }) => s.staff.id === noRateAide.staffId)).toBe(false);
    expect(res.warnings.map((w: { message: string }) => w.message).sort()).toEqual([
      '1 completed visit(s) not paid yet — EVV isn\'t verified',
      'No hourly or per-visit rate — visits not paid (set it in Staff)',
    ]);
  });

  it('keeps bonuses and deductions across recalculation', async () => {
    const period = (await http().get(`${base}/pay-periods/${periodId}`).set(admin).expect(200)).body.data;
    const aideStub = period.stubs.find((s: { staff: { id: string } }) => s.staff.id === hourlyAide.staffId);
    await http().patch(`${base}/pay-stubs/${aideStub.id}`).set(admin).send({ deductions: 5000 }).expect(400);
    const adjusted = (await http().patch(`${base}/pay-stubs/${aideStub.id}`).set(admin).send({ bonusAmount: 50, deductions: 10, notes: 'Holiday bonus' }).expect(200)).body.data;
    expect(adjusted.grossPay).toBe(1070);
    const again = (await http().post(`${base}/pay-periods/${periodId}/calculate`).set(admin).expect(200)).body.data;
    expect(again.stubs.find((s: { staff: { id: string } }) => s.staff.id === hourlyAide.staffId)).toMatchObject({ bonusAmount: 50, deductions: 10, grossPay: 1070, notes: 'Holiday bonus' });
  });

  it('approval locks the period, tells staff, and opens their stubs to them', async () => {
    expect((await http().get(`${base}/my-stubs`).set(hourlyAide.auth).expect(200)).body.data).toEqual([]); // not yet
    await http().post(`${base}/pay-periods/${periodId}/export`).set(admin).expect(409); // approve first
    await http().post(`${base}/pay-periods/${periodId}/approve`).set(admin).expect(200);
    await http().post(`${base}/pay-periods/${periodId}/approve`).set(admin).expect(409);
    await http().post(`${base}/pay-periods/${periodId}/calculate`).set(admin).expect(409);
    expect(await prisma.notification.count({ where: { userId: hourlyAide.userId, type: 'payroll_ready' } })).toBe(1);

    const stubs = (await http().get(`${base}/my-stubs`).set(hourlyAide.auth).expect(200)).body.data;
    expect(stubs).toHaveLength(1);
    await http().get(`${base}/pay-stubs/${stubs[0].id}`).set(hourlyAide.auth).expect(200);
    await http().get(`${base}/pay-stubs/${stubs[0].id}`).set(visitNurse.auth).expect(404); // not theirs
    await http().patch(`${base}/pay-stubs/${stubs[0].id}`).set(admin).send({ bonusAmount: 1 }).expect(409);
  });

  it('exports a CSV for the payroll provider', async () => {
    const file = (await http().post(`${base}/pay-periods/${periodId}/export`).set(admin).expect(200)).body.data;
    expect(file.fileName).toBe(`payroll-${periodStart}-to-${periodEnd}.csv`);
    const lines = file.content.trim().split('\r\n');
    expect(lines[0]).toBe('employee_id,last_name,first_name,discipline,regular_hours,overtime_hours,visits,regular_pay,overtime_pay,per_visit_pay,bonus,deductions,gross_pay,mileage_miles,mileage_reimbursement');
    expect(lines).toContain('E100,home_health_aide-E100,Pat,HHA,44.00,5.00,6,880.00,150.00,0.00,50.00,10.00,1070.00,10.00,7.00');
    expect(lines).toContain('E200,registered_nurse-E200,Pat,RN,0.00,0.00,2,0.00,0.00,100.00,0.00,0.00,100.00,0.00,0.00');
    expect((await http().get(`${base}/pay-periods/${periodId}`).set(admin).expect(200)).body.data.status).toBe('exported');
  });
});
