import { useState, useCallback, useRef, useEffect } from 'react';

type BalanceState = {
  value: string | null;
  loading: boolean;
  error: boolean;
  txCount: number | null;
  txLoading: boolean;
  txError: boolean;
  lastTxTime: string | null;       // ISO string of last tx
  lastTxCounterparty: string | null; // address most recently sent-to / received-from
  lastTxLoading: boolean;
  lastTxError: boolean;
};

type QueueItem = {
  address: string;
  network: 'btc' | 'eth';
  withLastTx: boolean;
  attempt: number;
};

/** How many addresses are folded into a single upstream request. */
const ETH_BATCH = 25;
const BTC_BATCH = 40;
/** How many batch requests may be in flight at once. */
const MAX_BATCHES_IN_FLIGHT = 3;
/** Retries before an address is reported as an error (never silently "0"). */
const MAX_ATTEMPTS = 4;

const EMPTY: BalanceState = {
  value: null, loading: false, error: false,
  txCount: null, txLoading: false, txError: false,
  lastTxTime: null, lastTxCounterparty: null, lastTxLoading: false, lastTxError: false,
};

export function useBalanceChecker() {
  const [balances, setBalances] = useState<Map<string, BalanceState>>(new Map());
  const queueRef = useRef<QueueItem[]>([]);
  const lastTxQueueRef = useRef<QueueItem[]>([]);
  const inFlightRef = useRef(0);
  const lastTxInFlightRef = useRef(0);
  const pendingPatchRef = useRef<Map<string, Partial<BalanceState>>>(new Map());
  const flushTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => () => { aliveRef.current = false; }, []);

  /** Coalesce state writes — a batch of 40 addresses becomes one React update. */
  const update = useCallback((address: string, patch: Partial<BalanceState>) => {
    const cur = pendingPatchRef.current.get(address) || {};
    pendingPatchRef.current.set(address, { ...cur, ...patch });
    if (flushTimerRef.current !== null) return;
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      const patches = pendingPatchRef.current;
      pendingPatchRef.current = new Map();
      if (!aliveRef.current || patches.size === 0) return;
      setBalances(prev => {
        const next = new Map(prev);
        patches.forEach((p, addr) => {
          next.set(addr, { ...(next.get(addr) || EMPTY), ...p });
        });
        return next;
      });
    }, 120);
  }, []);

  const drainRef = useRef<() => void>(() => {});

  const requeue = useCallback((items: QueueItem[]) => {
    const retryable = items.filter(i => i.attempt + 1 < MAX_ATTEMPTS);
    const dead = items.filter(i => i.attempt + 1 >= MAX_ATTEMPTS);
    dead.forEach(i => update(i.address, {
      loading: false, error: true, txLoading: false, txError: true,
    }));
    if (retryable.length === 0) return;
    const delay = 400 * Math.pow(2, retryable[0].attempt); // 400 / 800 / 1600ms
    window.setTimeout(() => {
      queueRef.current.push(...retryable.map(i => ({ ...i, attempt: i.attempt + 1 })));
      drainRef.current();
    }, delay);
  }, [update]);

  const drain = useCallback(() => {
    // ── Balance + tx-count batches ──
    while (inFlightRef.current < MAX_BATCHES_IN_FLIGHT && queueRef.current.length > 0) {
      const network = queueRef.current[0].network;
      const size = network === 'eth' ? ETH_BATCH : BTC_BATCH;
      const batch: QueueItem[] = [];
      // Take up to `size` consecutive items of the same network.
      queueRef.current = queueRef.current.filter(item => {
        if (batch.length < size && item.network === network) {
          batch.push(item);
          return false;
        }
        return true;
      });
      if (batch.length === 0) break;
      inFlightRef.current++;
      batch.forEach(i => update(i.address, {
        loading: true, error: false, txLoading: true, txError: false,
      }));

      (async () => {
        const addresses = batch.map(i => i.address);
        try {
          const res = network === 'eth'
            ? await fetchEthBatch(addresses)
            : await fetchBtcBatch(addresses);
          const missing: QueueItem[] = [];
          for (const item of batch) {
            const r = res.get(item.address);
            if (!r) { missing.push(item); continue; }
            update(item.address, {
              value: r.balance, loading: false, error: false,
              txCount: r.txCount, txLoading: false, txError: false,
            });
            if (item.withLastTx) lastTxQueueRef.current.push(item);
          }
          if (missing.length) requeue(missing);
        } catch {
          requeue(batch);
        }
        inFlightRef.current--;
        drainRef.current();
      })();
    }

    // ── Last-tx detail (lowest priority, never blocks screening) ──
    while (lastTxInFlightRef.current < 2 && lastTxQueueRef.current.length > 0) {
      const item = lastTxQueueRef.current.shift()!;
      lastTxInFlightRef.current++;
      update(item.address, { lastTxLoading: true, lastTxError: false });
      (async () => {
        try {
          const last = item.network === 'eth'
            ? await fetchEthLastTx(item.address)
            : await fetchBtcLastTx(item.address);
          update(item.address, {
            lastTxTime: last.time,
            lastTxCounterparty: last.counterparty,
            lastTxLoading: false,
            lastTxError: false,
          });
        } catch {
          update(item.address, { lastTxLoading: false, lastTxError: true });
        }
        lastTxInFlightRef.current--;
        drainRef.current();
      })();
    }
  }, [update, requeue]);

  drainRef.current = drain;

  const checkBalance = useCallback(
    (address: string, network: 'btc' | 'eth', opts?: { withLastTx?: boolean }) => {
      queueRef.current.push({
        address,
        network,
        withLastTx: opts?.withLastTx !== false,
        attempt: 0,
      });
      drainRef.current();
    },
    []
  );

  const getBalance = useCallback((address: string): BalanceState => {
    return balances.get(address) || EMPTY;
  }, [balances]);

  return { checkBalance, getBalance };
}

async function fetchWithTimeout(url: string, options?: RequestInit, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type ChainRecord = { balance: string; txCount: number };

// ── Ethereum: one batched JSON-RPC POST covers balance + nonce for N addresses ──
const ETH_RPC_ENDPOINTS = [
  'https://eth.llamarpc.com',
  'https://ethereum-rpc.publicnode.com',
  'https://rpc.ankr.com/eth',
  'https://1rpc.io/eth',
];

async function fetchEthBatch(addresses: string[]): Promise<Map<string, ChainRecord>> {
  const payload = addresses.flatMap((addr, i) => ([
    { jsonrpc: '2.0', id: `b${i}`, method: 'eth_getBalance', params: [addr, 'latest'] },
    { jsonrpc: '2.0', id: `n${i}`, method: 'eth_getTransactionCount', params: [addr, 'latest'] },
  ]));

  let lastErr: unknown;
  for (const endpoint of ETH_RPC_ENDPOINTS) {
    try {
      const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }, 12000);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data)) throw new Error('Batch RPC unsupported');
      const byId = new Map<string, string>();
      for (const entry of data) {
        if (entry?.error || typeof entry?.result !== 'string') continue;
        byId.set(String(entry.id), entry.result);
      }
      const out = new Map<string, ChainRecord>();
      addresses.forEach((addr, i) => {
        const bal = byId.get(`b${i}`);
        const nonce = byId.get(`n${i}`);
        if (bal === undefined || nonce === undefined) return; // retried by caller
        out.set(addr, {
          balance: formatWeiToEth(BigInt(bal)),
          txCount: Number(BigInt(nonce)),
        });
      });
      if (out.size === 0) throw new Error('Empty batch response');
      return out;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`All ETH providers failed: ${lastErr}`);
}

// ── Bitcoin: blockchain.info multi-address endpoint returns balance + n_tx together ──
async function fetchBtcBatch(addresses: string[]): Promise<Map<string, ChainRecord>> {
  const out = new Map<string, ChainRecord>();
  try {
    const res = await fetchWithTimeout(
      `https://blockchain.info/balance?active=${addresses.join('|')}&cors=true`,
      undefined,
      12000
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, { final_balance: number; n_tx: number }>;
    for (const addr of addresses) {
      const rec = data[addr];
      if (!rec) continue;
      out.set(addr, {
        balance: formatSatoshiToBtc(BigInt(rec.final_balance ?? 0)),
        txCount: Number(rec.n_tx ?? 0),
      });
    }
    if (out.size > 0) return out;
  } catch {
    // fall through to per-address provider
  }

  // Fallback: Blockstream, one request per address, small concurrency.
  const missing = addresses.filter(a => !out.has(a));
  const CONCURRENCY = 4;
  for (let i = 0; i < missing.length; i += CONCURRENCY) {
    const slice = missing.slice(i, i + CONCURRENCY);
    await Promise.all(slice.map(async addr => {
      try {
        const res = await fetchWithTimeout(`https://blockstream.info/api/address/${addr}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        const funded = BigInt(d.chain_stats?.funded_txo_sum ?? 0) + BigInt(d.mempool_stats?.funded_txo_sum ?? 0);
        const spent = BigInt(d.chain_stats?.spent_txo_sum ?? 0) + BigInt(d.mempool_stats?.spent_txo_sum ?? 0);
        out.set(addr, {
          balance: formatSatoshiToBtc(funded - spent),
          txCount: Number(d.chain_stats?.tx_count ?? 0) + Number(d.mempool_stats?.tx_count ?? 0),
        });
      } catch {
        // leave missing → caller retries
      }
    }));
  }
  if (out.size === 0) throw new Error('All BTC providers failed');
  return out;
}

// ── Last transaction info ──────────────────────────────────────────────────
type LastTx = { time: string | null; counterparty: string | null };

async function fetchBtcLastTx(address: string): Promise<LastTx> {
  // Blockstream — list of recent confirmed txs (newest first)
  const res = await fetchWithTimeout(`https://blockstream.info/api/address/${address}/txs`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const txs = await res.json() as Array<{
    status?: { block_time?: number };
    vin: Array<{ prevout?: { scriptpubkey_address?: string } }>;
    vout: Array<{ scriptpubkey_address?: string }>;
  }>;
  if (!Array.isArray(txs) || txs.length === 0) return { time: null, counterparty: null };
  const tx = txs[0];
  const blockTime = tx.status?.block_time;
  const time = blockTime ? new Date(blockTime * 1000).toISOString() : null;

  // Determine if this address sent or received, then pick counterparty
  const inputAddrs = tx.vin.map(i => i.prevout?.scriptpubkey_address).filter(Boolean) as string[];
  const isSender = inputAddrs.includes(address);
  let counterparty: string | null = null;
  if (isSender) {
    const out = tx.vout.find(o => o.scriptpubkey_address && o.scriptpubkey_address !== address);
    counterparty = out?.scriptpubkey_address ?? null;
  } else {
    counterparty = inputAddrs.find(a => a !== address) ?? inputAddrs[0] ?? null;
  }
  return { time, counterparty };
}

async function fetchEthLastTx(address: string): Promise<LastTx> {
  // Use Blockscout (no API key required)
  const url = `https://eth.blockscout.com/api?module=account&action=txlist&address=${address}&sort=desc&page=1&offset=1`;
  const res = await fetchWithTimeout(url, undefined, 8000);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const tx = Array.isArray(data?.result) ? data.result[0] : null;
  if (!tx) return { time: null, counterparty: null };
  const ts = Number(tx.timeStamp);
  const time = Number.isFinite(ts) ? new Date(ts * 1000).toISOString() : null;
  const lower = address.toLowerCase();
  const counterparty = (tx.from && tx.from.toLowerCase() === lower) ? tx.to : tx.from;
  return { time, counterparty: counterparty ?? null };
}

function formatWeiToEth(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = wei % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, '0').slice(0, 4);
  return `${whole}.${fracStr} ETH`;
}

function formatSatoshiToBtc(satoshis: bigint): string {
  const whole = satoshis / 100_000_000n;
  const frac = satoshis % 100_000_000n;
  const fracStr = frac.toString().padStart(8, '0');
  return `${whole}.${fracStr} BTC`;
}
