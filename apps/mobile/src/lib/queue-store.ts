import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import type { QueuedOp, QueueStore } from './offline-queue';

const KEY_NAME = 'alora.queueKey';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** A random 256-bit database key, created once and kept in the device keychain (never backed up). */
async function databaseKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (existing) return existing;
  const key = Array.from(getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
  await SecureStore.setItemAsync(KEY_NAME, key, KEY_OPTIONS);
  return key;
}

export interface ReadCache {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  clear(): Promise<void>;
}

/**
 * The offline queue and read cache in SQLite, encrypted with SQLCipher (DECISIONS D-048) — queued items can contain PHI (vitals,
 * notes). SQLCipher is compiled into real builds via the expo-sqlite plugin; Expo Go ignores the key, so Expo Go
 * must only ever be used with the FAKE demo data.
 */
export async function openQueueStore(): Promise<{ store: QueueStore; cache: ReadCache }> {
  const db = await SQLite.openDatabaseAsync('alora-queue.db');
  // The key is hex, so it can't break out of the statement.
  await db.execAsync(`PRAGMA key = "x'${await databaseKey()}'"`);
  await db.execAsync('CREATE TABLE IF NOT EXISTS ops (id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, json TEXT NOT NULL)');
  await db.execAsync('CREATE TABLE IF NOT EXISTS cache (key TEXT PRIMARY KEY NOT NULL, json TEXT NOT NULL)');
  const cache: ReadCache = {
    async get(key) {
      const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM cache WHERE key = ?', [key]);
      return rows[0] ? (JSON.parse(rows[0].json) as unknown) : undefined;
    },
    async set(key, value) {
      await db.runAsync('INSERT OR REPLACE INTO cache (key, json) VALUES (?, ?)', [key, JSON.stringify(value)]);
    },
    async clear() {
      await db.runAsync('DELETE FROM cache');
    },
  };
  const store: QueueStore = {
    async list() {
      const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM ops ORDER BY created_at, id');
      return rows.map((r) => JSON.parse(r.json) as QueuedOp);
    },
    async add(op) {
      await db.runAsync('INSERT INTO ops (id, created_at, json) VALUES (?, ?, ?)', [op.id, op.createdAt, JSON.stringify(op)]);
    },
    async remove(id) {
      await db.runAsync('DELETE FROM ops WHERE id = ?', [id]);
    },
    async markFailed(id, message) {
      const rows = await db.getAllAsync<{ json: string }>('SELECT json FROM ops WHERE id = ?', [id]);
      if (!rows[0]) return;
      const op = { ...(JSON.parse(rows[0].json) as QueuedOp), failure: message };
      await db.runAsync('UPDATE ops SET json = ? WHERE id = ?', [JSON.stringify(op), id]);
    },
  };
  return { store, cache };
}
