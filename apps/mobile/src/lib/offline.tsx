import { randomUUID } from 'expo-crypto';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Alert, AppState } from 'react-native';
import { OfflineError, type ApiResult, type RequestOptions } from './api';
import { useAuth } from './auth-context';
import { cancelAllReminders } from './notifications';
import { classify, OfflineQueue, type NewOp, type QueuedOp } from './offline-queue';
import { openQueueStore, type ReadCache } from './queue-store';

type Request = <T>(path: string, options?: Omit<RequestOptions, 'accessToken'>) => Promise<ApiResult<T>>;

/** Performs one queued (or about-to-be-queued) operation against the API. */
export async function sendOp(request: Request, op: NewOp): Promise<unknown> {
  const base = `/schedule/visits/${op.visitId}`;
  switch (op.kind) {
    case 'clock-in':
    case 'clock-out':
      return (await request(`/evv/${op.kind}`, { method: 'POST', body: op.body })).data;
    case 'task':
      return (await request(`${base}/tasks/${op.taskId}`, { method: 'PATCH', body: op.body })).data;
    case 'vitals':
      return (await request(`${base}/vitals`, { method: 'POST', body: op.body })).data;
    case 'note': {
      let noteId = op.draftId;
      if (noteId) {
        await request(`${base}/notes/${noteId}`, { method: 'PATCH', body: op.fields });
      } else {
        const { data } = await request<{ id: string }>(`${base}/notes`, {
          method: 'POST',
          body: { noteType: op.noteType, ...op.fields, ...(op.amendsNoteId ? { amendsNoteId: op.amendsNoteId } : {}) },
        });
        noteId = data.id;
      }
      if (op.finalise) await request(`${base}/notes/${noteId}/${op.finalise}`, { method: 'POST' });
      return { id: noteId };
    }
  }
}

export type Submitted = { outcome: 'sent'; data: unknown } | { outcome: 'queued' };

export interface Read<T> {
  data: T;
  /** Served from the phone because the API couldn't be reached. */
  stale: boolean;
}

interface OfflineValue {
  /** Everything saved on this phone and not yet accepted by the API (including refused items). */
  ops: QueuedOp[];
  /** Sends now if possible (with the API's answer); saves on the phone when offline. Throws when the API refuses it. */
  submit(op: NewOp): Promise<Submitted>;
  /** GET with a fallback to the last copy saved on this phone when offline. */
  read<T>(path: string): Promise<Read<T>>;
  flush(): Promise<void>;
  dismiss(id: string): Promise<void>;
  /** Asks first if unsent work would be lost, then wipes the queue and cache and signs out. */
  signOut(): void;
}

const OfflineContext = createContext<OfflineValue | null>(null);

export function useOffline(): OfflineValue {
  const value = useContext(OfflineContext);
  if (!value) throw new Error('useOffline must be used inside <OfflineProvider>');
  return value;
}

/**
 * Offline work (DECISIONS D-048). New work goes straight to the API when nothing is waiting; otherwise — or when the
 * phone is offline — it joins the queue, so everything reaches the API in the order it happened. The queue is sent
 * when the app comes to the foreground, every 30 seconds while something is waiting, and after each new item.
 * Reads fall back to the last copy saved on the phone. Queue and cache are encrypted and wiped at sign-out.
 */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { status, request } = auth;
  const [queue, setQueue] = useState<OfflineQueue | null>(null);
  const [cache, setCache] = useState<ReadCache | null>(null);
  const [ops, setOps] = useState<QueuedOp[]>([]);
  const requestRef = useRef(request);
  useEffect(() => {
    requestRef.current = request;
  });

  useEffect(() => {
    let cancelled = false;
    void openQueueStore().then(async ({ store, cache: c }) => {
      if (cancelled) return;
      const q = new OfflineQueue(store, (op) => sendOp(requestRef.current, op), randomUUID);
      setQueue(q);
      setCache(c);
      setOps(await q.list());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const flush = useCallback(async () => {
    if (!queue || status !== 'signed-in') return;
    await queue.flush();
    setOps(await queue.list());
  }, [queue, status]);

  useEffect(() => {
    void flush();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void flush());
    return () => sub.remove();
  }, [flush]);

  const waiting = ops.some((op) => !op.failure);
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void flush(), 30_000);
    return () => clearInterval(timer);
  }, [waiting, flush]);

  const value = useMemo<OfflineValue>(
    () => ({
      ops,
      submit: async (op) => {
        if (!queue) return { outcome: 'sent', data: await sendOp(request, op) };
        if (!(await queue.list()).some((o) => !o.failure)) {
          try {
            return { outcome: 'sent', data: await sendOp(request, op) };
          } catch (error) {
            if (classify(error) === 'failed') throw error;
          }
        }
        const queued = await queue.enqueue(op);
        await flush();
        const still = (await queue.list()).find((o) => o.id === queued.id);
        if (still?.failure) throw new Error(still.failure);
        return still ? { outcome: 'queued' } : { outcome: 'sent', data: undefined };
      },
      read: async <T,>(path: string): Promise<Read<T>> => {
        try {
          const { data } = await request<T>(path);
          await cache?.set(path, data);
          return { data, stale: false };
        } catch (error) {
          const saved = error instanceof OfflineError ? await cache?.get(path) : undefined;
          if (saved === undefined) throw error;
          return { data: saved as T, stale: true };
        }
      },
      flush,
      dismiss: async (id) => {
        await queue?.remove(id);
        if (queue) setOps(await queue.list());
      },
      signOut: () => {
        const wipe = async () => {
          if (queue) for (const op of await queue.list()) await queue.remove(op.id);
          await cache?.clear();
          await cancelAllReminders();
          setOps([]);
          await auth.signOut();
        };
        const unsent = ops.filter((op) => !op.failure).length;
        if (!unsent) return void wipe();
        Alert.alert(
          'Unsent work',
          `${unsent} change${unsent === 1 ? ' is' : 's are'} saved on this phone and not sent yet. Signing out deletes ${unsent === 1 ? 'it' : 'them'}.`,
          [
            { text: 'Stay signed in', style: 'cancel' },
            { text: 'Sign out anyway', style: 'destructive', onPress: () => void wipe() },
          ],
        );
      },
    }),
    [ops, queue, cache, request, flush, auth],
  );

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>;
}
