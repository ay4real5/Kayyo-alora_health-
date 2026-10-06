import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { AssistantService, type MessagesClient } from '../src/modules/assistant/assistant.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string } };

/** A stand-in for Claude that replies with the scripted messages, in order, and records what it was sent. */
function fakeClaude(...replies: Record<string, unknown>[]) {
  const create = vi.fn(async (_params: unknown) => {
    const next = replies.shift();
    if (!next) throw new Error('no scripted reply left');
    return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', usage: {}, stop_sequence: null, ...next };
  });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}
const toolUse = (name: string, input: Record<string, unknown>, id = `tu_${randomUUID()}`) => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name, input }],
});
const answer = (text: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });

describe.skipIf(!hasDb)('Assistant (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let assistant: AssistantService;
  let agencyId: string;
  let office: Person;
  let aide: Person;
  let patientId: string;
  const http = () => request(app.getHttpServer());
  const ask = (who: Person, question: string) =>
    http().post('/api/v1/assistant/chat').set(who.auth).send({ messages: [{ role: 'user', content: question }] });

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    assistant = app.get(AssistantService);
    agencyId = (await prisma.agency.create({ data: { name: `Assistant ${randomUUID()}`, timezone: 'UTC' } })).id;
    office = await seedUser('office_staff');
    aide = await seedUser('home_health_aide');
    patientId = (
      await prisma.patient.create({
        data: { agencyId, firstName: 'Zelda', lastName: `Assist-${randomUUID().slice(0, 6)}`, dateOfBirth: new Date('1938-05-01T00:00:00Z'), status: 'active' },
      })
    ).id;
  });

  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.patient.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `assistant-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Asa',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
      },
    });
    return { id: user.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  it('is for office roles only, and offers each person only the lookups their role allows', async () => {
    await http().get('/api/v1/assistant/status').set(aide.auth).expect(403);
    await ask(aide, 'Who are my patients?').expect(403);
    expect((await http().get('/api/v1/assistant/status').set(office.auth).expect(200)).body.data).toMatchObject({ enabled: true, model: 'claude-haiku-4-5' });

    const names = (await assistant.toolsFor({ userId: office.id, agencyId } as never)).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['find_patients', 'find_staff', 'list_visits', 'list_open_shifts']));
    expect(names).not.toContain('list_pay_periods'); // office staff have no payroll access
    expect(names).not.toContain('list_claims'); // nor billing
  });

  it('looks things up as the person asking, audits the lookup without the search words, and links to the record', async () => {
    const { client, create } = fakeClaude(toolUse('find_patients', { search: 'Zelda' }), answer('Found Zelda.'));
    assistant.client = client;
    const res = await ask(office, 'Find Zelda').expect(200);
    expect(res.body.data).toEqual({ reply: 'Found Zelda.', lookups: ['find_patients'] });

    // The second call carried the tool result back to the model.
    const second = create.mock.calls[1]![0] as { messages: { role: string; content: unknown }[]; tools: { name: string }[] };
    const result = JSON.stringify(second.messages.at(-1)!.content);
    expect(result).toContain('Zelda');
    expect(result).toContain(`/patients/${patientId}`);
    expect(second.tools.map((t) => t.name)).not.toContain('list_pay_periods');

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { agencyId, userId: office.id, action: 'ASSISTANT_LOOKUP' } });
    expect(audit).toMatchObject({ resourceType: 'find_patients', details: { results: 1 } });
    expect(JSON.stringify(audit.details)).not.toContain('Zelda');
  });

  it('refuses lookups the person may not use, and bad arguments, as errors the model can explain', async () => {
    const { client, create } = fakeClaude(
      toolUse('list_pay_periods', {}),
      toolUse('find_patients', { status: 'everyone' }),
      answer('You don’t have access to payroll.'),
    );
    assistant.client = client;
    const res = await ask(office, 'What did we pay last month?').expect(200);
    expect(res.body.data.reply).toBe('You don’t have access to payroll.');
    // The conversation sent on the last call holds every tool result, in order.
    const last = create.mock.calls.at(-1)![0] as { messages: { content: unknown }[] };
    const errors = last.messages
      .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
      .filter((b: { type?: string }) => b.type === 'tool_result')
      .map((b) => JSON.stringify(b));
    expect(errors[0]).toContain('"is_error":true');
    expect(errors[0]).toContain('isn’t available');
    expect(errors[1]).toContain('"is_error":true');
  });

  it('needs the conversation to end with a question, and stays off in production until the BAA is confirmed', async () => {
    await http()
      .post('/api/v1/assistant/chat')
      .set(office.auth)
      .send({ messages: [{ role: 'assistant', content: 'Hi' }] })
      .expect(400);

    const config = app.get(ConfigService);
    const get = config.get.bind(config);
    const spy = vi.spyOn(config, 'get').mockImplementation(((key: string, opts?: unknown) =>
      key === 'APP_ENV' ? 'production' : key === 'ASSISTANT_BAA_CONFIRMED' ? false : get(key as never, opts as never)) as typeof config.get);
    expect(assistant.status()).toEqual({ enabled: false, reason: 'baa_required' });
    await ask(office, 'Find Zelda').expect(503);
    spy.mockRestore();
  });
});
