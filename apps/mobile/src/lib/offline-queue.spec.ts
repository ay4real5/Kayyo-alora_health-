import { describe, expect, it } from 'vitest';
import { ApiError, OfflineError } from './api';
import { classify, effectiveStatus, OfflineQueue, type QueuedOp, type QueueStore } from './offline-queue';

function memoryStore(): QueueStore & { ops: QueuedOp[] } {
  return {
    ops: [],
    async list() {
      return [...this.ops];
    },
    async add(op) {
      this.ops.push(op);
    },
    async remove(id) {
      this.ops = this.ops.filter((o) => o.id !== id);
    },
    async markFailed(id, message) {
      this.ops = this.ops.map((o) => (o.id === id ? { ...o, failure: message } : o));
    },
  };
}

const clockIn = { kind: 'clock-in' as const, visitId: 'v1', body: { visitId: 'v1', latitude: 1, longitude: 2, timestamp: 't' } };
const vitals = { kind: 'vitals' as const, visitId: 'v1', body: { heartRate: 70, recordedAt: 't' } };
const task = { kind: 'task' as const, visitId: 'v1', taskId: 't1', body: { completed: true } };

function setup(send: (op: QueuedOp) => Promise<void>) {
  const store = memoryStore();
  let n = 0;
  let clock = 1000;
  const queue = new OfflineQueue(store, send, () => `op${++n}`, () => clock++);
  return { store, queue };
}

describe('OfflineQueue', () => {
  it('sends in the order things happened and empties the queue', async () => {
    const sent: string[] = [];
    const { store, queue } = setup(async (op) => void sent.push(op.kind));
    await queue.enqueue(clockIn);
    await queue.enqueue(vitals);
    await queue.enqueue(task);
    expect(await queue.flush()).toEqual({ sent: 3, failed: 0, stopped: false });
    expect(sent).toEqual(['clock-in', 'vitals', 'task']);
    expect(store.ops).toEqual([]);
  });

  it('stops at the first connection problem and keeps the rest for later', async () => {
    const sent: string[] = [];
    let online = false;
    const { store, queue } = setup(async (op) => {
      if (!online && op.kind === 'vitals') throw new OfflineError();
      sent.push(op.kind);
    });
    await queue.enqueue(clockIn);
    await queue.enqueue(vitals);
    await queue.enqueue(task);
    expect(await queue.flush()).toEqual({ sent: 1, failed: 0, stopped: true });
    expect(store.ops.map((o) => o.kind)).toEqual(['vitals', 'task']);
    online = true;
    expect((await queue.flush()).sent).toBe(2);
    expect(sent).toEqual(['clock-in', 'vitals', 'task']);
  });

  it('sets aside what the API refuses, with its message, and carries on', async () => {
    const { store, queue } = setup(async (op) => {
      if (op.kind === 'clock-in') throw new ApiError(409, 'This visit is cancelled');
    });
    await queue.enqueue(clockIn);
    await queue.enqueue(task);
    expect(await queue.flush()).toEqual({ sent: 1, failed: 1, stopped: false });
    expect(store.ops).toHaveLength(1);
    expect(store.ops[0]).toMatchObject({ kind: 'clock-in', failure: 'This visit is cancelled' });
    // Failed ones are not retried automatically.
    expect(await queue.flush()).toEqual({ sent: 0, failed: 0, stopped: false });
  });

  it('runs one flush at a time', async () => {
    let calls = 0;
    const { queue } = setup(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
    });
    await queue.enqueue(clockIn);
    await Promise.all([queue.flush(), queue.flush()]);
    expect(calls).toBe(1);
  });
});

describe('classify', () => {
  it('retries connection and server problems, gives up on refusals', () => {
    expect(classify(new OfflineError())).toBe('retry');
    expect(classify(new ApiError(503, 'down'))).toBe('retry');
    expect(classify(new ApiError(401, 'session'))).toBe('retry');
    expect(classify(new ApiError(400, 'bad'))).toBe('failed');
    expect(classify(new ApiError(409, 'conflict'))).toBe('failed');
  });
});

describe('effectiveStatus', () => {
  const op = (kind: 'clock-in' | 'clock-out', failure?: string) =>
    ({ ...clockIn, kind, id: kind, createdAt: 1, ...(failure ? { failure } : {}) }) as QueuedOp;
  it('counts clock events still waiting to be sent', () => {
    expect(effectiveStatus('scheduled', 'v1', [])).toBe('scheduled');
    expect(effectiveStatus('scheduled', 'v1', [op('clock-in')])).toBe('in_progress');
    expect(effectiveStatus('scheduled', 'v1', [op('clock-in'), op('clock-out')])).toBe('completed');
    expect(effectiveStatus('scheduled', 'v2', [op('clock-in')])).toBe('scheduled');
    expect(effectiveStatus('scheduled', 'v1', [op('clock-in', 'refused')])).toBe('scheduled');
  });
});
