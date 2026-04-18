import { useState, useCallback, useRef } from 'react';

type BalanceState = {
  value: string | null;
  loading: boolean;
  error: boolean;
  txCount: number | null;
  txLoading: boolean;
  txError: boolean;
};

const MAX_CONCURRENT = 3;

const EMPTY: BalanceState = {
  value: null, loading: false, error: false,
  txCount: null, txLoading: false, txError: false,
};

export function useBalanceChecker() {
  const [balances, setBalances] = useState<Map<string, BalanceState>>(new Map());
  const queueRef = useRef<{ address: string; network: 'btc' | 'eth' }[]>([]);
  const activeRef = useRef(0);

  const update = useCallback((address: string, patch: Partial<BalanceState>) => {
    setBalances(prev => {
      const next = new Map(prev);
      const cur = next.get(address) || EMPTY;
      next.set(address, { ...cur, ...patch });
      return next;
    });
  }, []);

  const drain = useCallback(() => {
    while (activeRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
      const item = queueRef.current.shift()!;
      activeRef.current++;

      update(item.address, { loading: true, error: false, txLoading: true, txError: false });

      (async () => {
        // Balance
        try {
          const balance = item.network === 'eth'
            ? await fetchEthBalance(item.address)
            : await fetchBtcBalance(item.address);
          update(item.address, { value: balance, loading: false, error: false });
        } catch {
          update(item.address, { value: null, loading: false, error: true });
        }
        // Tx count
        try {
          const tx = item.network === 'eth'
            ? await fetchEthTxCount(item.address)
            : await fetchBtcTxCount(item.address);
          update(item.address, { txCount: tx, txLoading: false, txError: false });
        } catch {
          update(item.address, { txCount: null, txLoading: false, txError: true });
        }
        activeRef.current--;
        drain();
      })();
    }
  }, [update]);

  const checkBalance = useCallback((address: string, network: 'btc' | 'eth') => {
    queueRef.current.push({ address, network });
    drain();
  }, [drain]);

  const getBalance = useCallback((address: string): BalanceState => {
    return balances.get(address) || EMPTY;
  }, [balances]);

  return { checkBalance, getBalance };
}

async function fetchWithTimeout(url: string, options?: RequestInit, ms = 6000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tryJsonRpc(url: string, address: string): Promise<string> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [address, 'latest'],
      id: 1,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.result) throw new Error('No result');
  const wei = BigInt(data.result);
  return formatWeiToEth(wei);
}

async function tryJsonRpcTxCount(url: string, address: string): Promise<number> {
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getTransactionCount',
      params: [address, 'latest'],
      id: 1,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
  if (!data.result) throw new Error('No result');
  return Number(BigInt(data.result));
}

const ETH_RPC_ENDPOINTS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
];

async function fetchEthBalance(address: string): Promise<string> {
  const errors: string[] = [];
  for (const endpoint of ETH_RPC_ENDPOINTS) {
    try {
      return await tryJsonRpc(endpoint, address);
    } catch (e) {
      errors.push(`${endpoint}: ${e}`);
    }
  }
  throw new Error(`All ETH providers failed: ${errors.join('; ')}`);
}

async function fetchEthTxCount(address: string): Promise<number> {
  const errors: string[] = [];
  for (const endpoint of ETH_RPC_ENDPOINTS) {
    try {
      return await tryJsonRpcTxCount(endpoint, address);
    } catch (e) {
      errors.push(`${endpoint}: ${e}`);
    }
  }
  throw new Error(`All ETH tx providers failed: ${errors.join('; ')}`);
}

async function fetchBtcBalance(address: string): Promise<string> {
  const errors: string[] = [];

  try {
    const res = await fetchWithTimeout(`https://blockchain.info/q/addressbalance/${address}?confirmations=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const satoshis = BigInt(text.trim());
    return formatSatoshiToBtc(satoshis);
  } catch (e) {
    errors.push(`Blockchain.info: ${e}`);
  }

  try {
    const res = await fetchWithTimeout(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const funded = BigInt(data.chain_stats.funded_txo_sum);
    const spent = BigInt(data.chain_stats.spent_txo_sum);
    return formatSatoshiToBtc(funded - spent);
  } catch (e) {
    errors.push(`Blockstream: ${e}`);
  }

  throw new Error(`All BTC providers failed: ${errors.join('; ')}`);
}

async function fetchBtcTxCount(address: string): Promise<number> {
  const errors: string[] = [];

  try {
    const res = await fetchWithTimeout(`https://blockstream.info/api/address/${address}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const chain = Number(data.chain_stats?.tx_count ?? 0);
    const mem = Number(data.mempool_stats?.tx_count ?? 0);
    return chain + mem;
  } catch (e) {
    errors.push(`Blockstream: ${e}`);
  }

  try {
    const res = await fetchWithTimeout(`https://blockchain.info/q/getreceivedbyaddress/${address}`);
    // Fallback: blockchain.info doesn't expose tx count cleanly via q/, try rawaddr
    const res2 = await fetchWithTimeout(`https://blockchain.info/rawaddr/${address}?limit=0`);
    if (!res2.ok) throw new Error(`HTTP ${res2.status}`);
    const data = await res2.json();
    return Number(data.n_tx ?? 0);
  } catch (e) {
    errors.push(`Blockchain.info: ${e}`);
  }

  throw new Error(`All BTC tx providers failed: ${errors.join('; ')}`);
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
