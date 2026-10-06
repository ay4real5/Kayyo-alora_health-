import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string }; staffId?: string };

const COURSE = {
  title: 'Infection control basics',
  summary: 'Hand hygiene and gloves',
  content: 'Wash your hands for 20 seconds.\n\nChange gloves between tasks.',
  disciplines: ['HHA'],
  passPercent: 75,
  credentialType: 'Infection Control',
  validityMonths: 12,
  questions: [
    { prompt: 'How long should you wash your hands?', options: ['5 seconds', '20 seconds'], correctIndex: 1 },
    { prompt: 'When do you change gloves?', options: ['Between tasks', 'Once a day'], correctIndex: 0 },
    { prompt: 'Is hand sanitizer OK when hands look dirty?', options: ['Yes', 'No — wash them'], correctIndex: 1 },
    { prompt: 'Who needs hand hygiene?', options: ['Everyone', 'Only nurses'], correctIndex: 0 },
  ],
};

describe.skipIf(!hasDb)('Primordial Academy (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let agencyId: string;
  let supervisor: Person;
  let aide: Person;
  let nurse: Person;
  const http = () => request(app.getHttpServer());
  const api = (p: string) => `/api/v1${p}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    agencyId = (await prisma.agency.create({ data: { name: `Academy ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser('supervisor');
    aide = await seedUser('home_health_aide', 'HHA');
    nurse = await seedUser('registered_nurse', 'RN');
  });

  afterAll(async () => {
    await prisma.trainingCourse.deleteMany({ where: { agencyId } }); // questions and completions cascade
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `acad-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Ada',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('lets a supervisor write a course and an aide pass it, recording a credential', async () => {
    await http().post(api('/training/courses')).set(supervisor.auth).send({ ...COURSE, questions: [{ prompt: 'x', options: ['a', 'b'], correctIndex: 2 }] }).expect(400);
    const course = (await http().post(api('/training/courses')).set(supervisor.auth).send(COURSE).expect(201)).body.data;
    expect(course).toMatchObject({ credentialType: 'infection_control', questions: expect.arrayContaining([expect.objectContaining({ correctIndex: 1 })]) });
    await http().post(api('/training/courses')).set(aide.auth).send(COURSE).expect(403);

    // The aide sees it (HHA); the nurse doesn't (RN).
    const mine = (await http().get(api('/training/my')).set(aide.auth).expect(200)).body.data;
    expect(mine).toEqual([expect.objectContaining({ id: course.id, status: 'not_started', questions: 4, grantsCredential: true })]);
    expect((await http().get(api('/training/my')).set(nurse.auth).expect(200)).body.data).toEqual([]);
    await http().get(api(`/training/my/${course.id}`)).set(nurse.auth).expect(404);

    // The quiz never includes the answers.
    const lesson = (await http().get(api(`/training/my/${course.id}`)).set(aide.auth).expect(200)).body.data;
    expect(JSON.stringify(lesson)).not.toContain('correctIndex');
    expect(lesson.questions).toHaveLength(4);

    // 2 of 4 right: fail, told which ones were wrong, no credential.
    await http().post(api(`/training/my/${course.id}/submit`)).set(aide.auth).send({ answers: [1, 0] }).expect(400);
    const fail = (await http().post(api(`/training/my/${course.id}/submit`)).set(aide.auth).send({ answers: [1, 0, 0, 1] }).expect(200)).body.data;
    expect(fail).toEqual({ scorePercent: 50, passed: false, passPercent: 75, wrongQuestions: [3, 4], credentialRecorded: false });
    expect((await http().get(api('/training/my')).set(aide.auth).expect(200)).body.data[0]).toMatchObject({ status: 'failed', lastScore: 50 });

    // 3 of 4: pass at 75%, credential recorded for a year.
    const pass = (await http().post(api(`/training/my/${course.id}/submit`)).set(aide.auth).send({ answers: [1, 0, 1, 1] }).expect(200)).body.data;
    expect(pass).toMatchObject({ scorePercent: 75, passed: true, credentialRecorded: true });
    const credential = await prisma.staffCredential.findFirstOrThrow({ where: { staffProfileId: aide.staffId!, credentialType: 'infection_control' } });
    expect(credential).toMatchObject({ credentialName: 'Infection control basics', issuingAuthority: 'Primordial Academy' });
    expect(credential.expiryDate!.getTime() - credential.issueDate!.getTime()).toBeGreaterThan(364 * 86_400_000);
    const status = (await http().get(api('/training/my')).set(aide.auth).expect(200)).body.data[0];
    expect(status).toMatchObject({ status: 'passed', validUntil: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });

    // Supervisors see results and pass counts.
    const results = (await http().get(api(`/training/courses/${course.id}/results`)).set(supervisor.auth).expect(200)).body.data;
    expect(results.map((r: { scorePercent: number }) => r.scorePercent)).toEqual([75, 50]);
    expect((await http().get(api('/training/courses')).set(supervisor.auth).expect(200)).body.data[0]).toMatchObject({ passedBy: 1, questions: 4 });
  });

  it('hides inactive courses and lets the course be opened to everyone', async () => {
    const course = (await http().post(api('/training/courses')).set(supervisor.auth).send({ ...COURSE, title: 'Fire safety', credentialType: undefined, disciplines: [] }).expect(201)).body.data;
    expect((await http().get(api('/training/my')).set(nurse.auth).expect(200)).body.data.map((c: { title: string }) => c.title)).toEqual(['Fire safety']);
    const pass = (await http().post(api(`/training/my/${course.id}/submit`)).set(nurse.auth).send({ answers: [1, 0, 1, 0] }).expect(200)).body.data;
    expect(pass).toMatchObject({ passed: true, credentialRecorded: false }); // this course grants no credential
    await http().patch(api(`/training/courses/${course.id}`)).set(supervisor.auth).send({ isActive: false }).expect(200);
    expect((await http().get(api('/training/my')).set(nurse.auth).expect(200)).body.data).toEqual([]);
    await http().post(api(`/training/my/${course.id}/submit`)).set(nurse.auth).send({ answers: [1, 0, 1, 0] }).expect(404);
    await http().get(api('/training/my')).set(supervisor.auth).expect(404); // no staff profile
  });
});
