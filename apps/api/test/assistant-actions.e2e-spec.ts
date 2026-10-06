import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { addDays, toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssistantService, type MessagesClient } from '../src/modules/assistant/assistant.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string }; staffId?: string };

function fakeClaude(...replies: Record<string, unknown>[]) {
  const create = vi.fn(async (_params: unknown) => {
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply left');
    return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', usage: {}, stop_sequence: null, ...next };
  });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const toolUse = (name: string, input: Record<string, unknown>) => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${randomUUID()}`, name, input }] });
const answer = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

describe.skipIf(!hasDb)('Assistant actions (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assistant: AssistantService;
  let agencyId: string;
  let supervisor: Person;
  let office: Person;
  let aide: Person;
  let visitId: string;
  let timeOffId: string;
  const http = () => request(app.getHttpServer());
  const ask = (who: Person, q: string) => http().post('/api/v1/assistant/chat').set(who.auth).send({ messages: [{ role: 'user', content: q }] });
  const confirm = (who: Person, kind: string, params: Record<string, unknown>) => http().post('/api/v1/assistant/actions').set(who.auth).send({ kind, params });

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    assistant = app.get(AssistantService);
    agencyId = (await prisma.agency.create({ data: { name: `Assistant Actions ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser('supervisor');
    office = await seedUser('office_staff');
    aide = await seedUser('home_health_aide', 'HHA', 'Ana');
    const patientId = (
      await prisma.patient.create({ data: { agencyId, firstName: 'Paz', lastName: 'Action', dateOfBirth: new Date('1940-01-01T00:00:00Z'), status: 'active' } })
    ).id;
    visitId = (
      await prisma.visit.create({
        data: { agencyId, patientId, visitType: 'home_health_aide', scheduledDate: toDate(addDays(utcTodayString(), 5))!, scheduledStart: toTime('09:00'), scheduledEnd: toTime('11:00') },
      })
    ).id;
    timeOffId = (
      await prisma.staffTimeOff.create({
        data: { staffProfileId: aide.staffId!, startDate: toDate(addDays(utcTodayString(), 20))!, endDate: toDate(addDays(utcTodayString(), 21))!, type: 'vacation' },
      })
    ).id;
  });

  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.openShift.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string, firstName = 'Sam'): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `act-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName,
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('prepares a Confirm card without changing anything, then does it only when confirmed', async () => {
    const { client, create } = fakeClaude(
      toolUse('prepare_assign_caregiver', { visitId: `/schedule/visits/${visitId}`, staffId: `/staff/${aide.staffId}` }),
      answer('Please confirm assigning Ana.'),
    );
    assistant.client = client;
    const res = (await ask(supervisor, 'Assign Ana to the Action visit').expect(200)).body.data;
    expect(res.actions).toEqual([
      expect.objectContaining({
        kind: 'assign_caregiver',
        title: 'Assign Ana home_health_aide to Paz Action’s visit',
        params: { visitId, staffId: aide.staffId },
        confirmLabel: 'Assign',
      }),
    ]);
    expect(res.actions[0].details).toEqual(expect.arrayContaining(['Home health aide', 'Currently has no caregiver']));
    // The model was told it hasn't happened.
    expect(JSON.stringify((create.mock.calls[1]![0] as { messages: unknown[] }).messages.at(-1))).toContain('NOT happened yet');
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBeNull();

    const done = (await confirm(supervisor, 'assign_caregiver', res.actions[0].params).expect(200)).body.data;
    expect(done).toMatchObject({ link: `/schedule/visits/${visitId}` });
    expect((await prisma.visit.findUniqueOrThrow({ where: { id: visitId } })).staffId).toBe(aide.staffId);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { agencyId, action: 'ASSISTANT_ACTION', userId: supervisor.id } });
    expect(audit).toMatchObject({ resourceType: 'assign_caregiver', details: { params: { visitId, staffId: aide.staffId } } });
  });

  it('decides time off through the same rules (not your own, only once)', async () => {
    const done = (await confirm(supervisor, 'decide_time_off', { timeOffId, status: 'approved' }).expect(200)).body.data;
    expect(done.message).toMatch(/^Approved/);
    expect((await prisma.staffTimeOff.findUniqueOrThrow({ where: { id: timeOffId } })).status).toBe('approved');
    await confirm(supervisor, 'decide_time_off', { timeOffId, status: 'denied' }).expect(409);
  });

  it('only offers and runs actions the person’s role allows', async () => {
    const names = (await assistant.toolsFor({ userId: office.id, agencyId } as never)).map((t) => t.name);
    expect(names).toContain('prepare_assign_caregiver');
    expect(names).not.toContain('prepare_export_payroll'); // office staff have no payroll
    expect(names).not.toContain('prepare_decide_time_off'); // nor visits:approve
    await confirm(office, 'export_payroll', { payPeriodId: randomUUID() }).expect(403);
    await confirm(office, 'decide_time_off', { timeOffId, status: 'approved' }).expect(403);
    await confirm(aide, 'assign_caregiver', { visitId, staffId: aide.staffId }).expect(403); // no assistant at all
    await confirm(supervisor, 'assign_caregiver', { visitId: 'not-an-id', staffId: aide.staffId }).expect(400);
    await confirm(supervisor, 'delete_everything', {}).expect(400);
  });
});
