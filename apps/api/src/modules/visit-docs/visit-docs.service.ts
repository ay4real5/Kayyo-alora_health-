import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PermissionsService } from '../rbac/permissions.service.js';
import type {
  AddTasksDto,
  CreateVisitNoteDto,
  CreateVitalsDto,
  UpdateTaskDto,
  UpdateVisitNoteDto,
} from './dto/visit-docs.dto.js';

const HOUR = 3_600_000;
const MAX_BACKDATE_HOURS = 72;
/** Documentation belongs to a visit that is happening or has happened. */
const DOCUMENTABLE = ['in_progress', 'completed'];

const NOTE_INCLUDE = {
  author: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.VisitNoteInclude;
type NoteRow = Prisma.VisitNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;
type VitalRow = Prisma.VisitVitalGetPayload<object>;
type TaskRow = Prisma.VisitTaskGetPayload<object>;

interface VisitRef {
  id: string;
  status: string;
  staffId: string | null;
  staffUserId: string | null;
}

export interface VisitNoteView {
  id: string;
  visitId: string;
  noteType: string;
  status: string;
  author: { id: string; firstName: string; lastName: string };
  subjective: string | null;
  objective: string | null;
  assessment: string | null;
  plan: string | null;
  narrative: string | null;
  formData: unknown;
  amendsNoteId: string | null;
  submittedAt: Date | null;
  signedAt: Date | null;
  signedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface VitalView {
  id: string;
  visitId: string;
  recordedById: string;
  bloodPressureSystolic: number | null;
  bloodPressureDiastolic: number | null;
  heartRate: number | null;
  respiratoryRate: number | null;
  temperature: number | null;
  temperatureUnit: string;
  oxygenSaturation: number | null;
  weight: number | null;
  weightUnit: string;
  painLevel: number | null;
  bloodGlucose: number | null;
  notes: string | null;
  recordedAt: Date;
  enteredInError: { at: Date; byId: string | null; reason: string | null } | null;
}

export interface TaskView {
  id: string;
  visitId: string;
  taskName: string;
  description: string | null;
  /** open | done | not_done */
  state: 'open' | 'done' | 'not_done';
  completedAt: Date | null;
  completedById: string | null;
  notDoneReason: string | null;
  sortOrder: number;
}

/**
 * Visit documentation (DESIGN.md §6.5; DECISIONS D-039): notes, vitals and task checklists. Reading follows visit
 * access (D-030). Writing is for the visit's own caregiver, while the visit is in progress or done; the office adds
 * tasks beforehand. Signed/submitted notes and recorded vitals are never edited — addenda and "entered in error".
 */
@Injectable()
export class VisitDocsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
  ) {}

  // ── Notes ──────────────────────────────────────────────────────────────────────────────────────────────

  async listNotes(caller: AuthUser, visitId: string): Promise<VisitNoteView[]> {
    await this.readableVisit(caller, visitId);
    const notes = await this.prisma.visitNote.findMany({
      where: { visitId },
      include: NOTE_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
    return notes.map(toNoteView);
  }

  async createNote(
    caller: AuthUser,
    visitId: string,
    dto: CreateVisitNoteDto,
  ): Promise<VisitNoteView> {
    const visit = await this.ownDocumentableVisit(caller, visitId);
    const isAddendum = dto.noteType === 'addendum';
    if (isAddendum !== Boolean(dto.amendsNoteId)) {
      throw new BadRequestException(
        'An addendum needs amendsNoteId, and only an addendum can have one',
      );
    }
    if (dto.amendsNoteId) {
      const original = await this.prisma.visitNote.findFirst({
        where: { id: dto.amendsNoteId, visitId },
      });
      if (!original)
        throw new BadRequestException('amendsNoteId does not match a note on this visit');
      if (original.status === 'draft')
        throw new ConflictException('Edit the draft instead of amending it');
    }
    const note = await this.prisma.visitNote.create({
      data: {
        visitId,
        staffId: visit.staffId!,
        authorId: caller.userId,
        noteType: dto.noteType,
        amendsNoteId: dto.amendsNoteId ?? null,
        ...content(dto),
      },
      include: NOTE_INCLUDE,
    });
    return toNoteView(note);
  }

  async updateNote(
    caller: AuthUser,
    visitId: string,
    noteId: string,
    dto: UpdateVisitNoteDto,
  ): Promise<VisitNoteView> {
    await this.draftByCaller(caller, visitId, noteId);
    const note = await this.prisma.visitNote.update({
      where: { id: noteId },
      data: content(dto),
      include: NOTE_INCLUDE,
    });
    return toNoteView(note);
  }

  async deleteNote(caller: AuthUser, visitId: string, noteId: string): Promise<void> {
    await this.draftByCaller(caller, visitId, noteId);
    await this.prisma.visitNote.delete({ where: { id: noteId } });
  }

  /** Clinician's signature: locks the note. */
  async signNote(caller: AuthUser, visitId: string, noteId: string): Promise<VisitNoteView> {
    return this.lock(caller, visitId, noteId, 'signed');
  }

  /** For roles that don't sign (aides): locks the note as their final entry. */
  async submitNote(caller: AuthUser, visitId: string, noteId: string): Promise<VisitNoteView> {
    return this.lock(caller, visitId, noteId, 'submitted');
  }

  private async lock(
    caller: AuthUser,
    visitId: string,
    noteId: string,
    status: 'signed' | 'submitted',
  ) {
    const note = await this.draftByCaller(caller, visitId, noteId);
    if (
      ![note.subjective, note.objective, note.assessment, note.plan, note.narrative].some((t) =>
        t?.trim(),
      )
    ) {
      throw new BadRequestException('Write the note before finalising it');
    }
    const now = new Date();
    const done = await this.prisma.visitNote.updateMany({
      where: { id: noteId, status: 'draft' },
      data:
        status === 'signed'
          ? { status, signedAt: now, signedById: caller.userId }
          : { status, submittedAt: now },
    });
    if (!done.count) throw new ConflictException('This note was just finalised');
    return toNoteView(
      await this.prisma.visitNote.findUniqueOrThrow({
        where: { id: noteId },
        include: NOTE_INCLUDE,
      }),
    );
  }

  private async draftByCaller(caller: AuthUser, visitId: string, noteId: string): Promise<NoteRow> {
    await this.readableVisit(caller, visitId);
    const note = await this.prisma.visitNote.findFirst({
      where: { id: noteId, visitId },
      include: NOTE_INCLUDE,
    });
    if (!note) throw new NotFoundException('Note not found');
    if (note.authorId !== caller.userId)
      throw new ForbiddenException('Only the author can change this note');
    if (note.status !== 'draft')
      throw new ConflictException(`This note is ${note.status}; add an addendum instead`);
    return note;
  }

  // ── Vitals ─────────────────────────────────────────────────────────────────────────────────────────────

  async listVitals(caller: AuthUser, visitId: string): Promise<VitalView[]> {
    await this.readableVisit(caller, visitId);
    const vitals = await this.prisma.visitVital.findMany({
      where: { visitId },
      orderBy: { recordedAt: 'asc' },
    });
    return vitals.map(toVitalView);
  }

  async recordVitals(caller: AuthUser, visitId: string, dto: CreateVitalsDto): Promise<VitalView> {
    await this.ownDocumentableVisit(caller, visitId);
    const measured = [
      dto.bloodPressureSystolic,
      dto.heartRate,
      dto.respiratoryRate,
      dto.temperature,
      dto.oxygenSaturation,
      dto.weight,
      dto.painLevel,
      dto.bloodGlucose,
    ];
    if (measured.every((v) => v === undefined))
      throw new BadRequestException('Record at least one measurement');
    if ((dto.bloodPressureSystolic === undefined) !== (dto.bloodPressureDiastolic === undefined)) {
      throw new BadRequestException('Blood pressure needs both systolic and diastolic');
    }
    if (
      dto.bloodPressureSystolic !== undefined &&
      dto.bloodPressureDiastolic !== undefined &&
      dto.bloodPressureDiastolic >= dto.bloodPressureSystolic
    ) {
      throw new BadRequestException('Diastolic must be lower than systolic');
    }
    const unit = dto.temperatureUnit ?? 'F';
    if (dto.temperature !== undefined) {
      const [min, max] = unit === 'F' ? [85, 115] : [29, 46];
      if (dto.temperature < min || dto.temperature > max) {
        throw new BadRequestException(`Temperature must be between ${min} and ${max} °${unit}`);
      }
    }
    const recordedAt = dto.recordedAt ? new Date(dto.recordedAt) : new Date();
    if (recordedAt.getTime() > Date.now() + 5 * 60_000)
      throw new BadRequestException('recordedAt is in the future');
    if (recordedAt.getTime() < Date.now() - MAX_BACKDATE_HOURS * HOUR) {
      throw new BadRequestException(`recordedAt is more than ${MAX_BACKDATE_HOURS} hours old`);
    }

    const vital = await this.prisma.visitVital.create({
      data: {
        visitId,
        recordedById: caller.userId,
        bloodPressureSystolic: dto.bloodPressureSystolic ?? null,
        bloodPressureDiastolic: dto.bloodPressureDiastolic ?? null,
        heartRate: dto.heartRate ?? null,
        respiratoryRate: dto.respiratoryRate ?? null,
        temperature: dto.temperature ?? null,
        temperatureUnit: unit,
        oxygenSaturation: dto.oxygenSaturation ?? null,
        weight: dto.weight ?? null,
        weightUnit: dto.weightUnit ?? 'lbs',
        painLevel: dto.painLevel ?? null,
        bloodGlucose: dto.bloodGlucose ?? null,
        notes: dto.notes ?? null,
        recordedAt,
      },
    });
    return toVitalView(vital);
  }

  /** Vitals are never edited or deleted; a wrong entry is marked, and stays visible as such. */
  async markVitalInError(
    caller: AuthUser,
    visitId: string,
    vitalId: string,
    reason: string,
  ): Promise<VitalView> {
    await this.readableVisit(caller, visitId);
    const vital = await this.prisma.visitVital.findFirst({ where: { id: vitalId, visitId } });
    if (!vital) throw new NotFoundException('Vitals entry not found');
    const access = await this.permissions.forUser(caller);
    if (vital.recordedById !== caller.userId && !access.permissions.has('visits:read_all')) {
      throw new ForbiddenException(
        'Only the person who recorded these vitals, or a supervisor, can mark them',
      );
    }
    const done = await this.prisma.visitVital.updateMany({
      where: { id: vitalId, enteredInErrorAt: null },
      data: {
        enteredInErrorAt: new Date(),
        enteredInErrorById: caller.userId,
        enteredInErrorReason: reason,
      },
    });
    if (!done.count) throw new ConflictException('Already marked as entered in error');
    return toVitalView(await this.prisma.visitVital.findUniqueOrThrow({ where: { id: vitalId } }));
  }

  // ── Tasks ──────────────────────────────────────────────────────────────────────────────────────────────

  async listTasks(caller: AuthUser, visitId: string): Promise<TaskView[]> {
    await this.readableVisit(caller, visitId);
    return (await this.tasks(visitId)).map(toTaskView);
  }

  /** The office sets up the checklist before or during the visit. */
  async addTasks(caller: AuthUser, visitId: string, dto: AddTasksDto): Promise<TaskView[]> {
    const visit = await this.readableVisit(caller, visitId);
    if (!['scheduled', 'in_progress'].includes(visit.status)) {
      throw new ConflictException(`Tasks can't be added to a ${visit.status} visit`);
    }
    const last = await this.prisma.visitTask.aggregate({
      where: { visitId },
      _max: { sortOrder: true },
    });
    const start = (last._max.sortOrder ?? -1) + 1;
    await this.prisma.visitTask.createMany({
      data: dto.tasks.map((t, i) => ({
        visitId,
        taskName: t.taskName,
        description: t.description ?? null,
        sortOrder: start + i,
      })),
    });
    return (await this.tasks(visitId)).map(toTaskView);
  }

  async removeTask(caller: AuthUser, visitId: string, taskId: string): Promise<void> {
    await this.readableVisit(caller, visitId);
    const task = await this.prisma.visitTask.findFirst({ where: { id: taskId, visitId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.completedById)
      throw new ConflictException('The caregiver already recorded this task; it stays');
    await this.prisma.visitTask.delete({ where: { id: taskId } });
  }

  /** The caregiver marks a task done, not done (with a reason), or back to open. */
  async updateTask(
    caller: AuthUser,
    visitId: string,
    taskId: string,
    dto: UpdateTaskDto,
  ): Promise<TaskView> {
    await this.ownDocumentableVisit(caller, visitId);
    const task = await this.prisma.visitTask.findFirst({ where: { id: taskId, visitId } });
    if (!task) throw new NotFoundException('Task not found');
    if (dto.completed && dto.notDoneReason) {
      throw new BadRequestException('A completed task has no "not done" reason');
    }
    const open = !dto.completed && !dto.notDoneReason;
    const updated = await this.prisma.visitTask.update({
      where: { id: taskId },
      data: {
        isCompleted: dto.completed,
        completedAt: open ? null : new Date(),
        completedById: open ? null : caller.userId,
        notDoneReason: dto.notDoneReason ?? null,
      },
    });
    return toTaskView(updated);
  }

  private tasks(visitId: string): Promise<TaskRow[]> {
    return this.prisma.visitTask.findMany({
      where: { visitId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  // ── Access ─────────────────────────────────────────────────────────────────────────────────────────────

  /** A visit the caller can see (agency; `visits:read_all` or their own). Otherwise 404. */
  private async readableVisit(caller: AuthUser, visitId: string): Promise<VisitRef> {
    const access = await this.permissions.forUser(caller);
    const visit = await this.prisma.visit.findFirst({
      where: {
        id: visitId,
        agencyId: caller.agencyId,
        ...(access.permissions.has('visits:read_all') ? {} : { staff: { userId: caller.userId } }),
      },
      select: { id: true, status: true, staffId: true, staff: { select: { userId: true } } },
    });
    if (!visit) throw new NotFoundException('Visit not found');
    return {
      id: visit.id,
      status: visit.status,
      staffId: visit.staffId,
      staffUserId: visit.staff?.userId ?? null,
    };
  }

  /** The caller's own visit, in progress or done — where documentation is written. */
  private async ownDocumentableVisit(caller: AuthUser, visitId: string): Promise<VisitRef> {
    const visit = await this.readableVisit(caller, visitId);
    if (visit.staffUserId !== caller.userId) {
      throw new ForbiddenException("Only the visit's caregiver documents it");
    }
    if (!DOCUMENTABLE.includes(visit.status)) {
      throw new ConflictException(
        visit.status === 'scheduled'
          ? 'Clock in before documenting the visit'
          : `This visit is ${visit.status}`,
      );
    }
    return visit;
  }
}

function content(dto: UpdateVisitNoteDto) {
  return {
    ...(dto.subjective !== undefined ? { subjective: dto.subjective || null } : {}),
    ...(dto.objective !== undefined ? { objective: dto.objective || null } : {}),
    ...(dto.assessment !== undefined ? { assessment: dto.assessment || null } : {}),
    ...(dto.plan !== undefined ? { plan: dto.plan || null } : {}),
    ...(dto.narrative !== undefined ? { narrative: dto.narrative || null } : {}),
    ...(dto.formData !== undefined ? { formData: dto.formData as Prisma.InputJsonValue } : {}),
  };
}

function toNoteView(note: NoteRow): VisitNoteView {
  return {
    id: note.id,
    visitId: note.visitId,
    noteType: note.noteType,
    status: note.status,
    author: note.author,
    subjective: note.subjective,
    objective: note.objective,
    assessment: note.assessment,
    plan: note.plan,
    narrative: note.narrative,
    formData: note.formData,
    amendsNoteId: note.amendsNoteId,
    submittedAt: note.submittedAt,
    signedAt: note.signedAt,
    signedById: note.signedById,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

const num = (value: Prisma.Decimal | null): number | null =>
  value === null ? null : Number(value);

function toVitalView(v: VitalRow): VitalView {
  return {
    id: v.id,
    visitId: v.visitId,
    recordedById: v.recordedById,
    bloodPressureSystolic: v.bloodPressureSystolic,
    bloodPressureDiastolic: v.bloodPressureDiastolic,
    heartRate: v.heartRate,
    respiratoryRate: v.respiratoryRate,
    temperature: num(v.temperature),
    temperatureUnit: v.temperatureUnit,
    oxygenSaturation: num(v.oxygenSaturation),
    weight: num(v.weight),
    weightUnit: v.weightUnit,
    painLevel: v.painLevel,
    bloodGlucose: v.bloodGlucose,
    notes: v.notes,
    recordedAt: v.recordedAt,
    enteredInError: v.enteredInErrorAt
      ? { at: v.enteredInErrorAt, byId: v.enteredInErrorById, reason: v.enteredInErrorReason }
      : null,
  };
}

function toTaskView(t: TaskRow): TaskView {
  return {
    id: t.id,
    visitId: t.visitId,
    taskName: t.taskName,
    description: t.description,
    state: t.isCompleted ? 'done' : t.notDoneReason ? 'not_done' : 'open',
    completedAt: t.completedAt,
    completedById: t.completedById,
    notDoneReason: t.notDoneReason,
    sortOrder: t.sortOrder,
  };
}
