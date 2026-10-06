import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, type OnApplicationShutdown } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { fromDate } from '../../common/utils/dates.js';
import { PrismaService } from '../../database/prisma.service.js';
import { ClaudeService } from '../ai/claude.service.js';
import { ComplianceService } from '../compliance/compliance.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { FLAG_LABEL, REPORT_TYPE, keywordIncidents, type IncidentFlagType } from './incident-detect.js';
import { VisitDocsService } from './visit-docs.service.js';

const FLAG_TYPES = Object.keys(FLAG_LABEL) as IncidentFlagType[];
/** These are always flagged when mentioned, even if the AI thinks otherwise — a person decides. */
const ALWAYS_FLAG: IncidentFlagType[] = ['fall', 'abuse_neglect', 'medical_emergency'];

export interface OrganizedNote {
  /** Aide notes: one clear paragraph of what was done and observed. */
  narrative: string;
  /** Clinician notes: SOAP sections (empty strings when the dictation doesn't cover them). */
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  /** Visit tasks the caregiver said were done (ids from the visit's task list). */
  tasksDone: { id: string; taskName: string }[];
  /** Things the office should know (not incidents): appetite, mood, supplies, family requests. */
  concerns: string[];
  /** Possible reportable incidents in what was said — the caregiver is told before submitting. */
  possibleIncidents: { type: IncidentFlagType; label: string; reason: string }[];
}

const ORGANIZE_SYSTEM = `You turn a home-care caregiver's dictated visit summary into a clear, professional visit note.
Rules:
- Only use what the caregiver said. Never add care, observations, numbers or times they didn't mention. If something is unclear, leave it out.
- Plain, factual, third person ("Assisted client with…"), past tense, no slang, correct spelling. Keep the caregiver's facts and quantities exactly.
- narrative: one or two short paragraphs for an aide's activity note.
- subjective/objective/assessment/plan: for clinicians; use empty strings for sections the dictation doesn't cover. Don't diagnose.
- tasksDone: only tasks from the given task list that the caregiver clearly said were done; use the exact ids.
- concerns: short items the office should follow up (not incidents).
- possibleIncidents: anything that may need an incident report (falls, injuries, medication errors, abuse or neglect, medical emergencies, refusals of care or medication) with a one-sentence factual reason.`;

const INCIDENT_SYSTEM = `You review a submitted home-care visit note for possible reportable incidents: falls (including near-falls found on the floor), injuries, medication errors (missed, wrong or extra doses), abuse or neglect, medical emergencies (911, ER, chest pain, unresponsive), or refusals of care or medication.
Decide only from the note. Negated mentions ("no falls", "denies pain") are not incidents. When unsure, flag it — a supervisor reviews every flag. The reason is one short factual sentence without names.`;

/**
 * AI help with visit documentation (D-096):
 * - organize: dictated text → a structured draft the caregiver reviews (nothing is saved);
 * - scanSubmitted: after a note is submitted or signed, flag possible incidents and alert the people who handle them;
 * - incident flags: file a prefilled incident report, or dismiss the flag;
 * - care updates: a short family-friendly update for the portal, optionally suggested from the note.
 */
@Injectable()
export class NoteAiService implements OnApplicationShutdown {
  private readonly logger = new Logger(NoteAiService.name);
  /** Scans started by scanInBackground and not finished yet. */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    private readonly docs: VisitDocsService,
    private readonly compliance: ComplianceService,
    private readonly notifications: NotificationsService,
  ) {}

  get aiEnabled(): boolean {
    return this.claude.enabled;
  }

  async organize(caller: AuthUser, visitId: string, text: string): Promise<OrganizedNote> {
    const visit = await this.docs.visitForDocumenting(caller, visitId);
    const tasks = await this.prisma.visitTask.findMany({ where: { visitId: visit.id }, select: { id: true, taskName: true }, orderBy: { taskName: 'asc' } });
    const taskList = tasks.length ? tasks.map((t) => `${t.id}: ${t.taskName}`).join('\n') : '(no task list)';
    const out = await this.claude.structured<Partial<OrganizedNote> & { tasksDone?: string[] }>(
      ORGANIZE_SYSTEM,
      `Visit tasks:\n${taskList}\n\nDictated summary:\n"""${text}"""`,
      {
        name: 'visit_note',
        description: 'The organized visit note.',
        input_schema: {
          type: 'object',
          properties: {
            narrative: { type: 'string' },
            subjective: { type: 'string' },
            objective: { type: 'string' },
            assessment: { type: 'string' },
            plan: { type: 'string' },
            tasksDone: { type: 'array', items: { type: 'string', description: 'Task id' } },
            concerns: { type: 'array', items: { type: 'string' } },
            possibleIncidents: {
              type: 'array',
              items: {
                type: 'object',
                properties: { type: { type: 'string', enum: FLAG_TYPES }, reason: { type: 'string' } },
                required: ['type', 'reason'],
              },
            },
          },
          required: ['narrative', 'tasksDone', 'concerns', 'possibleIncidents'],
        },
      },
    );
    const done = new Set((out.tasksDone ?? []).map(String));
    const incidents = new Map<IncidentFlagType, string>();
    for (const i of (out.possibleIncidents ?? []) as { type: IncidentFlagType; reason: string }[]) {
      if (FLAG_TYPES.includes(i.type)) incidents.set(i.type, i.reason);
    }
    // The keyword check backs the model up.
    for (const hit of keywordIncidents(text)) if (!incidents.has(hit.type)) incidents.set(hit.type, `Mentions “${hit.phrase}”.`);
    const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
    return {
      narrative: s(out.narrative),
      subjective: s(out.subjective),
      objective: s(out.objective),
      assessment: s(out.assessment),
      plan: s(out.plan),
      tasksDone: tasks.filter((t) => done.has(t.id)),
      concerns: (out.concerns ?? []).map(s).filter(Boolean),
      possibleIncidents: [...incidents.entries()].map(([type, reason]) => ({ type, label: FLAG_LABEL[type], reason })),
    };
  }

  /** Start scanSubmitted without waiting for it (submit/sign answer straight away). */
  scanInBackground(noteId: string): void {
    const scan = this.scanSubmitted(noteId).finally(() => this.inFlight.delete(scan));
    this.inFlight.add(scan);
  }

  /** Resolves once every background scan has finished (shutdown, and tests before cleanup). */
  async idle(): Promise<void> {
    while (this.inFlight.size) await Promise.all(this.inFlight);
  }

  async onApplicationShutdown(): Promise<void> {
    await this.idle();
  }

  /** Runs after submit/sign; never throws (the note is already saved). */
  async scanSubmitted(noteId: string): Promise<void> {
    try {
      const note = await this.prisma.visitNote.findUnique({
        where: { id: noteId },
        select: {
          id: true,
          status: true,
          subjective: true,
          objective: true,
          assessment: true,
          plan: true,
          narrative: true,
          incidentFlagType: true,
          visit: { select: { id: true, agencyId: true } },
        },
      });
      if (!note || note.status === 'draft' || note.incidentFlagType) return;
      const text = [note.narrative, note.subjective, note.objective, note.assessment, note.plan].filter(Boolean).join('\n');
      if (!text.trim()) return;
      const hits = keywordIncidents(text);
      let flag: { type: IncidentFlagType; reason: string } | null = null;
      if (this.claude.enabled) {
        try {
          const ai = await this.claude.structured<{ incident: boolean; type?: IncidentFlagType; reason?: string }>(INCIDENT_SYSTEM, `Visit note:\n"""${text}"""`, {
            name: 'incident_check',
            description: 'Whether the note may describe a reportable incident.',
            input_schema: {
              type: 'object',
              properties: { incident: { type: 'boolean' }, type: { type: 'string', enum: FLAG_TYPES }, reason: { type: 'string' } },
              required: ['incident'],
            },
          });
          if (ai.incident && ai.type && FLAG_TYPES.includes(ai.type)) flag = { type: ai.type, reason: (ai.reason ?? '').slice(0, 480) || FLAG_LABEL[ai.type] };
        } catch (error) {
          this.logger.warn(`AI incident check failed for note ${noteId}; using keywords (${(error as Error).name})`);
        }
      }
      const critical = hits.find((h) => ALWAYS_FLAG.includes(h.type));
      if (!flag && (critical || (!this.claude.enabled && hits[0]))) {
        const hit = critical ?? hits[0]!;
        flag = { type: hit.type, reason: `The note mentions “${hit.phrase}”.` };
      }
      if (!flag) return;
      const updated = await this.prisma.visitNote.updateMany({
        where: { id: note.id, incidentFlagType: null },
        data: { incidentFlagType: flag.type, incidentFlagReason: flag.reason, incidentFlaggedAt: new Date(), incidentFlagStatus: 'open' },
      });
      if (!updated.count) return;
      const userIds = await this.compliance.usersWithPermission(note.visit.agencyId, 'compliance', 'update');
      await this.notifications.notify({
        agencyId: note.visit.agencyId,
        userIds,
        type: 'incident_flagged',
        title: 'Possible incident in a visit note',
        body: `${FLAG_LABEL[flag.type]} — open the visit to review the note and decide whether to file an incident report.`,
        data: { visitId: note.visit.id, noteId: note.id },
      });
    } catch (error) {
      this.logger.error(`Incident scan failed for note ${noteId}: ${(error as Error).name}`);
    }
  }

  /** File the prefilled incident report for a flag, or dismiss it. */
  async decideFlag(
    caller: AuthUser,
    visitId: string,
    noteId: string,
    dto: { action: 'report' | 'dismiss'; severity?: 'low' | 'moderate' | 'high' | 'critical'; description?: string },
  ) {
    await this.docs.visitForReading(caller, visitId);
    const note = await this.prisma.visitNote.findFirst({
      where: { id: noteId, visitId },
      select: { id: true, incidentFlagType: true, incidentFlagReason: true, incidentFlagStatus: true, visit: { select: { patientId: true, staffId: true, scheduledDate: true } } },
    });
    if (!note || !note.incidentFlagType) throw new NotFoundException('No incident flag on this note');
    if (note.incidentFlagStatus !== 'open') throw new ConflictException(`This flag was already ${note.incidentFlagStatus}`);
    let incidentId: string | null = null;
    if (dto.action === 'report') {
      const description = (dto.description ?? '').trim() || note.incidentFlagReason || FLAG_LABEL[note.incidentFlagType as IncidentFlagType];
      const incident = await this.compliance.createIncident(caller, {
        incidentType: REPORT_TYPE[note.incidentFlagType as IncidentFlagType] as never,
        severity: dto.severity ?? 'moderate',
        incidentDate: fromDate(note.visit.scheduledDate)!,
        description,
        patientId: note.visit.patientId,
        ...(note.visit.staffId ? { staffId: note.visit.staffId } : {}),
        visitId,
        followUpRequired: true,
      } as never);
      incidentId = (incident as { id: string }).id;
    }
    await this.prisma.visitNote.update({ where: { id: note.id }, data: { incidentFlagStatus: dto.action === 'report' ? 'reported' : 'dismissed' } });
    return { status: dto.action === 'report' ? 'reported' : 'dismissed', incidentId };
  }

  // ── Family care updates ────────────────────────────────────────────────────────────────────────────────

  /** A family-friendly draft from the visit's notes (the caregiver edits and sends it). */
  async suggestCareUpdate(caller: AuthUser, visitId: string): Promise<{ summary: string; mood: string | null }> {
    const visit = await this.docs.visitForDocumenting(caller, visitId);
    const notes = await this.prisma.visitNote.findMany({ where: { visitId: visit.id }, select: { narrative: true, subjective: true, objective: true } });
    const text = notes.flatMap((n) => [n.narrative, n.subjective, n.objective]).filter(Boolean).join('\n');
    if (!text.trim()) throw new BadRequestException('Write the visit note first, then a care update can be suggested from it');
    const out = await this.claude.structured<{ summary: string; mood?: string }>(
      `You write a short, warm update for a home-care client's family about today's visit, from the caregiver's note. 2–4 plain sentences: what was done, how they ate and felt, anything nice. Facts from the note only. No diagnoses, medication names, vital-sign numbers or clinical terms, and nothing alarming — concerns go to the office, not this update. Don't use the caregiver's or client's names. mood: good, okay or low, from the note (omit if unclear).`,
      `Visit note:\n"""${text}"""`,
      {
        name: 'care_update',
        description: 'The family update.',
        input_schema: { type: 'object', properties: { summary: { type: 'string' }, mood: { type: 'string', enum: ['good', 'okay', 'low'] } }, required: ['summary'] },
      },
    );
    return { summary: (out.summary ?? '').trim().slice(0, 1000), mood: out.mood ?? null };
  }

  async saveCareUpdate(caller: AuthUser, visitId: string, dto: { summary: string; mood?: string }) {
    const visit = await this.docs.visitForDocumenting(caller, visitId);
    const row = await this.prisma.visit.findUniqueOrThrow({ where: { id: visit.id }, select: { agencyId: true, patientId: true, staffId: true } });
    const data = { summary: dto.summary.trim(), mood: dto.mood ?? null };
    const saved = await this.prisma.careUpdate.upsert({
      where: { visitId: visit.id },
      create: { ...data, visitId: visit.id, agencyId: row.agencyId, patientId: row.patientId, staffProfileId: row.staffId! },
      update: data,
    });
    return { id: saved.id, summary: saved.summary, mood: saved.mood, createdAt: saved.createdAt };
  }

  async getCareUpdate(caller: AuthUser, visitId: string) {
    const visit = await this.docs.visitForReading(caller, visitId);
    const row = await this.prisma.careUpdate.findUnique({ where: { visitId: visit.id }, select: { id: true, summary: true, mood: true, createdAt: true } });
    return row;
  }
}
