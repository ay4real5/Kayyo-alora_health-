import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { vi } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { toDate, toTime, utcTodayString } from '../src/common/utils/dates.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { ClaudeService, type MessagesClient } from '../src/modules/ai/claude.service.js';
import { purgeAuditLogs } from '../src/modules/audit/purge-audit-logs.js';
import { PasswordService } from '../src/modules/auth/password.service.js';
import { NoteAiService } from '../src/modules/visit-docs/note-ai.service.js';
import { setupApp } from '../src/setup-app.js';
import { loginForTests } from './login-helper.js';

const hasDb = Boolean(process.env.DATABASE_URL);
const PASSWORD = 'Correct-Horse-9!';
const noThrottle = { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) };
type Person = { id: string; auth: { Authorization: string }; staffId?: string };

/** A stand-in for Claude: answers each call by calling the requested tool with the scripted input. */
function fakeClaude(...inputs: Record<string, unknown>[]) {
  const create = vi.fn(async (params: { tools: { name: string }[] }) => {
    const input = inputs.shift();
    if (!input) throw new Error('no scripted reply left');
    return { id: 'msg', type: 'message', role: 'assistant', model: 'claude-haiku-4-5', usage: {}, stop_sequence: null, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: `tu_${randomUUID()}`, name: params.tools[0]!.name, input }] };
  });
  return { client: { messages: { create } } as unknown as MessagesClient, create };
}

describe.skipIf(!hasDb)('AI documentation (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let claude: ClaudeService;
  let agencyId: string;
  let supervisor: Person;
  let aide: Person;
  let other: Person;
  let patientId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(noThrottle).compile();
    app = setupApp(moduleRef.createNestApplication({ logger: ['error'] }));
    await app.init();
    prisma = app.get(PrismaService);
    claude = app.get(ClaudeService);
    agencyId = (await prisma.agency.create({ data: { name: `Note AI ${randomUUID()}`, timezone: 'UTC' } })).id;
    supervisor = await seedUser('supervisor');
    aide = await seedUser('home_health_aide', 'HHA');
    other = await seedUser('home_health_aide', 'HHA');
    patientId = (await prisma.patient.create({ data: { agencyId, firstName: 'Nell', lastName: 'Notes', dateOfBirth: new Date('1939-01-01T00:00:00Z'), status: 'active' } })).id;
  });

  afterAll(async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await prisma.incidentReport.deleteMany({ where: { agencyId } });
    await prisma.visit.deleteMany({ where: { agencyId } });
    await prisma.patient.deleteMany({ where: { agencyId } });
    await prisma.notification.deleteMany({ where: { agencyId } });
    await purgeAuditLogs(prisma, agencyId);
    await prisma.user.deleteMany({ where: { agencyId } });
    await prisma.agency.delete({ where: { id: agencyId } });
    await app.close();
  });

  async function seedUser(roleName: string, discipline?: string): Promise<Person> {
    const role = await prisma.role.findFirstOrThrow({ where: { agencyId: null, name: roleName } });
    const email = `noteai-${randomUUID()}@example.test`;
    const user = await prisma.user.create({
      data: {
        agencyId,
        email,
        passwordHash: await app.get(PasswordService).hash(PASSWORD),
        passwordChangedAt: new Date(),
        firstName: 'Noa',
        lastName: roleName,
        userRoles: { create: { roleId: role.id } },
        ...(discipline ? { staffProfile: { create: { agencyId, discipline } } } : {}),
      },
      include: { staffProfile: true },
    });
    return { id: user.id, staffId: user.staffProfile?.id, auth: { Authorization: `Bearer ${await loginForTests(http(), email, PASSWORD)}` } };
  }

  async function visitInProgress(staffId: string) {
    return (
      await prisma.visit.create({
        data: {
          agencyId,
          patientId,
          staffId,
          status: 'in_progress',
          visitType: 'home_health_aide',
          scheduledDate: toDate(utcTodayString())!,
          scheduledStart: toTime('08:00'),
          scheduledEnd: toTime('10:00'),
          tasks: { create: [{ taskName: 'Bathing' }, { taskName: 'Meal preparation' }, { taskName: 'Medication reminder' }] },
        },
        include: { tasks: true },
      })
    );
  }

  async function submitNote(who: Person, visitId: string, narrative: string) {
    const note = (await http().post(`/api/v1/schedule/visits/${visitId}/notes`).set(who.auth).send({ noteType: 'aide_activity', narrative }).expect(201)).body.data;
    await http().post(`/api/v1/schedule/visits/${visitId}/notes/${note.id}/submit`).set(who.auth).expect(200);
    return note.id as string;
  }
  async function flagOf(noteId: string) {
    for (let i = 0; i < 50; i++) {
      const n = await prisma.visitNote.findUniqueOrThrow({ where: { id: noteId } });
      if (n.incidentFlagType) return n;
      await new Promise((r) => setTimeout(r, 100));
    }
    return prisma.visitNote.findUniqueOrThrow({ where: { id: noteId } });
  }

  it('organizes dictation into a draft: only real tasks, keyword backup for incidents, nothing saved', async () => {
    const visit = await visitInProgress(aide.staffId!);
    const bathing = visit.tasks.find((t) => t.taskName === 'Bathing')!;
    const { client, create } = fakeClaude({
      narrative: 'Assisted client with bathing and prepared breakfast; client ate about 75%.',
      tasksDone: [bathing.id, randomUUID()], // one made-up id must be dropped
      concerns: ['Low on incontinence supplies'],
      possibleIncidents: [],
    });
    claude.client = client;
    const draft = (
      await http()
        .post(`/api/v1/schedule/visits/${visit.id}/notes/organize`)
        .set(aide.auth)
        .send({ text: 'did her bath and made breakfast she ate like 75 percent, she slipped a bit in the hall but was ok, low on pads' })
        .expect(200)
    ).body.data;
    expect(draft.narrative).toMatch(/Assisted client with bathing/);
    expect(draft.tasksDone).toEqual([{ id: bathing.id, taskName: 'Bathing' }]);
    expect(draft.concerns).toEqual(['Low on incontinence supplies']);
    expect(draft.possibleIncidents).toEqual([expect.objectContaining({ type: 'fall', label: 'Possible fall' })]); // from the keywords
    expect(JSON.stringify(create.mock.calls[0]![0])).toContain('Meal preparation'); // the task list was given
    expect(await prisma.visitNote.count({ where: { visitId: visit.id } })).toBe(0);
    // Only the visit's own caregiver can use it.
    await http().post(`/api/v1/schedule/visits/${visit.id}/notes/organize`).set(other.auth).send({ text: 'x' }).expect(404);
  });

  it('flags a possible incident after submit, alerts supervisors, and turns it into a report', async () => {
    const visit = await visitInProgress(aide.staffId!);
    claude.client = fakeClaude({ incident: true, type: 'fall', reason: 'The client fell getting out of bed.' }).client;
    const noteId = await submitNote(aide, visit.id, 'Client fell getting out of bed but said she was okay. Assisted with breakfast.');
    const flagged = await flagOf(noteId);
    expect(flagged).toMatchObject({ incidentFlagType: 'fall', incidentFlagStatus: 'open', incidentFlagReason: 'The client fell getting out of bed.' });
    // The alert is sent in the background right after the flag is stored.
    let alert = null;
    for (let i = 0; i < 50 && !alert; i++) {
      alert = await prisma.notification.findFirst({ where: { agencyId, userId: supervisor.id, type: 'incident_flagged' } });
      if (!alert) await new Promise((r) => setTimeout(r, 100));
    }
    if (!alert) throw new Error('no incident alert');
    expect(`${alert.title} ${alert.body}`).not.toContain('Nell'); // no patient details in alerts

    const notes = (await http().get(`/api/v1/schedule/visits/${visit.id}/notes`).set(supervisor.auth).expect(200)).body.data;
    expect(notes[0].incidentFlag).toMatchObject({ type: 'fall', label: 'Possible fall', status: 'open' });

    await http().post(`/api/v1/schedule/visits/${visit.id}/notes/${noteId}/incident-flag/report`).set(other.auth).send({}).expect(404); // not their visit
    const res = (await http().post(`/api/v1/schedule/visits/${visit.id}/notes/${noteId}/incident-flag/report`).set(supervisor.auth).send({ severity: 'high' }).expect(200)).body.data;
    expect(res.status).toBe('reported');
    const incident = await prisma.incidentReport.findUniqueOrThrow({ where: { id: res.incidentId } });
    expect(incident).toMatchObject({ incidentType: 'fall', severity: 'high', patientId, visitId: visit.id, description: 'The client fell getting out of bed.' });
    await http().post(`/api/v1/schedule/visits/${visit.id}/notes/${noteId}/incident-flag/dismiss`).set(supervisor.auth).expect(409);
    await http().post(`/api/v1/schedule/visits/${visit.id}/notes/${noteId}/incident-flag/dismiss`).set(aide.auth).expect(403); // dismissing needs compliance:update
  });

  it('without AI, keywords flag it; routine notes and negations are left alone', async () => {
    const off = vi.spyOn(claude, 'enabled', 'get').mockReturnValue(false);
    try {
      const v1 = await visitInProgress(aide.staffId!);
      const routine = await submitNote(aide, v1.id, 'No falls today. Denies pain. Assisted with bathing and lunch.');
      const v2 = await visitInProgress(aide.staffId!);
      const refused = await submitNote(aide, v2.id, 'She refused her medication at noon.');
      expect((await flagOf(refused)).incidentFlagType).toBe('refusal');
      expect((await prisma.visitNote.findUniqueOrThrow({ where: { id: routine } })).incidentFlagType).toBeNull();
      expect((await http().get('/api/v1/ai/status').set(aide.auth).expect(200)).body.data).toEqual({ enabled: false });
      await http().post(`/api/v1/schedule/visits/${v2.id}/notes/organize`).set(aide.auth).send({ text: 'x' }).expect(503);
    } finally {
      off.mockRestore();
    }
  });

  it('suggests and saves a family care update for the visit', async () => {
    const visit = await visitInProgress(aide.staffId!);
    await submitNote(aide, visit.id, 'Assisted with shower and dressing. Ate 80% of breakfast. Walked 15 minutes. Mood good.');
    claude.client = fakeClaude({ incident: false }, { summary: 'Had a shower, ate most of breakfast and enjoyed a short walk.', mood: 'good' }).client;
    await app.get(NoteAiService).scanSubmitted((await prisma.visitNote.findFirstOrThrow({ where: { visitId: visit.id } })).id);
    const suggestion = (await http().post(`/api/v1/schedule/visits/${visit.id}/care-update/suggest`).set(aide.auth).expect(200)).body.data;
    expect(suggestion).toEqual({ summary: 'Had a shower, ate most of breakfast and enjoyed a short walk.', mood: 'good' });
    await http().post(`/api/v1/schedule/visits/${visit.id}/care-update`).set(aide.auth).send({ summary: suggestion.summary, mood: 'good' }).expect(200);
    const saved = (await http().get(`/api/v1/schedule/visits/${visit.id}/care-update`).set(supervisor.auth).expect(200)).body.data;
    expect(saved).toMatchObject({ summary: suggestion.summary, mood: 'good' });
    await http().post(`/api/v1/schedule/visits/${visit.id}/care-update`).set(other.auth).send({ summary: 'x' }).expect(404);
  });
});
