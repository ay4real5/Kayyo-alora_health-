import { ApiError, OfflineError } from './api';
import type { ClockBody } from './evv';

interface Base {
  id: string;
  visitId: string;
  /** When the caregiver did it (ms). */
  createdAt: number;
  /** Set when the API refused it — kept so the caregiver sees it; never retried automatically. */
  failure?: string;
}

export type NoteFields = { subjective: string; objective: string; assessment: string; plan: string; narrative: string };

export type QueuedOp = Base &
  (
    | { kind: 'clock-in' | 'clock-out'; body: ClockBody }
    | { kind: 'task'; taskId: string; body: { completed: boolean; notDoneReason?: string } }
    | { kind: 'vitals'; body: Record<string, unknown> & { recordedAt: string } }
    | {
        kind: 'note';
        draftId: string | null;
        noteType: string;
        amendsNoteId: string | null;
        fields: NoteFields;
        /** Sign (clinicians) or submit (aides) after saving; null = just save the draft. */
        finalise: 'sign' | 'submit' | null;
      }
  );

type Distribute<T> = T extends unknown ? Omit<T, 'id' | 'createdAt' | 'failure'> : never;
export type NewOp = Distribute<QueuedOp>;

/** Where queued work lives on the phone (encrypted SQLite in the app; memory in tests). */
export interface QueueStore {
  list(): Promise<QueuedOp[]>;
  add(op: QueuedOp): Promise<void>;
  remove(id: string): Promise<void>;
  markFailed(id: string, message: string): Promise<void>;
}

/** Sends one operation. Throw OfflineError (or a 5xx ApiError) to stop and retry later; a 4xx means it can't succeed. */
export type Sender = (op: QueuedOp) => Promise<unknown>;

export type Outcome = 'retry' | 'failed';

/** Offline, server trouble, or the session needs a sign-in → keep it and retry; the API refusing it → failed. */
export function classify(error: unknown): Outcome {
  if (error instanceof OfflineError) return 'retry';
  if (error instanceof ApiError) return error.status >= 500 || error.status === 401 || error.status === 429 ? 'retry' : 'failed';
  return 'retry';
}

export interface FlushResult {
  sent: number;
  failed: number;
  /** Stopped early: still offline (or the server is struggling). */
  stopped: boolean;
}

/**
 * Work done without a connection (DECISIONS D-048): saved on the phone and sent **in the order it happened** — a
 * clock-in before the notes written after it. One flush at a time; a refused operation is set aside with the API's
 * message and the rest continue.
 */
export class OfflineQueue {
  private flushing: Promise<FlushResult> | null = null;

  constructor(
    private readonly store: QueueStore,
    private readonly send: Sender,
    private readonly newId: () => string,
    private readonly now: () => number = Date.now,
  ) {}

  async enqueue(op: NewOp): Promise<QueuedOp> {
    const queued = { ...op, id: this.newId(), createdAt: this.now() } as QueuedOp;
    await this.store.add(queued);
    return queued;
  }

  list(): Promise<QueuedOp[]> {
    return this.store.list();
  }

  remove(id: string): Promise<void> {
    return this.store.remove(id);
  }

  flush(): Promise<FlushResult> {
    this.flushing ??= (async () => {
      const result: FlushResult = { sent: 0, failed: 0, stopped: false };
      try {
        const ops = (await this.store.list()).filter((op) => !op.failure).sort((a, b) => a.createdAt - b.createdAt);
        for (const op of ops) {
          try {
            await this.send(op);
            await this.store.remove(op.id);
            result.sent++;
          } catch (error) {
            if (classify(error) === 'retry') {
              result.stopped = true;
              break;
            }
            await this.store.markFailed(op.id, error instanceof Error ? error.message : 'Refused');
            result.failed++;
          }
        }
        return result;
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }
}

/** The visit's status as the caregiver should see it, counting clock events still waiting to be sent. */
export function effectiveStatus(serverStatus: string, visitId: string, ops: QueuedOp[]): string {
  const mine = ops.filter((op) => op.visitId === visitId && !op.failure);
  if (mine.some((op) => op.kind === 'clock-out')) return 'completed';
  if (mine.some((op) => op.kind === 'clock-in')) return 'in_progress';
  return serverStatus;
}
