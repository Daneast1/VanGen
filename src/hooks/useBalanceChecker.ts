import { useState, useCallback, useRef } from 'react';

type BalanceState = {
  value: string | null;
  loading: boolean;
  error: boolean;
};

const MAX_CONCURRENT = 5;

export function useBalanceChecker() {
  const [balances, setBalances] = useState<Map<string, BalanceState>>(new Map());
  const queueRef = useRef<{ address: string; network: 'btc' | 'eth' }[]>([]);
  const activeRef = useRef(0);
  const processingRef = useRef(false);

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;
    processingRef.current = true;

    while (queueRef.current.length > 0 && activeRef.current < MAX_CONCURRENT) {
      const item = queueRef.current.shift()!;
      activeRef.current++;

      setBalances(prev => {
        const next = new Map(prev);
        next.set(item.address, { value: null, loading: true, error: false });
        return next;
      });

      // Fire and forget — don't await, so we can launch multiple concurrently
      (async () => {
        try {
          const balance = item.network === 'eth'
            ? await fetchEthBalance(item.address)
            : await fetchBtcBalance(item.address);

          setBalances(prev => {
            const next = new Map(prev);
            next.set(item.address, { value: balance, loading: false, error: false });
            return next;
          });
        } catch {
          setBalances(prev => {
            const next = new Map(prev);
            next.set(item.address, { value: null, loading: false, error: true });
            return next;
          });
        }

        activeRef.current--;
        // Kick the queue again after one completes
        processingRef.current = false;
        processQueue();
      })();
    }

    processingRef.current = false;
  }, []);

  const checkBalance = useCallback((address: string, network: 'btc' | 'eth') => {
    queueRef.current.push({ address, network });
    processQueue();
  }, [processQueue]);

  const getBalance = useCallback((address: string): BalanceState => {
    return balances.get(address) || { value: null, loading: false, error: false };
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

const ETH_RPC_ENDPOINTS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://eth-mainnet.public.blastapi.io',
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

async function fetchBtcBalance(address: string): Promise<string> {
  const errors: string[] = [];

  // Provider 1: Blockchain.info
  try {
    const res = await fetchWithTimeout(`https://blockchain.info/q/addressbalance/${address}?confirmations=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const satoshis = BigInt(text.trim());
    return formatSatoshiToBtc(satoshis);
  } catch (e) {
    errors.push(`Blockchain.info: ${e}`);
  }

  // Provider 2: Blockstream
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

  // Provider 3: Blockcypher
  try {
    const res = await fetchWithTimeout(`https://api.blockcypher.com/v1/btc/main/addrs/${address}/balance`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const satoshis = BigInt(data.balance);
    return formatSatoshiToBtc(satoshis);
  } catch (e) {
    errors.push(`Blockcypher: ${e}`);
  }

  throw new Error(`All BTC providers failed: ${errors.join('; ')}`);
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
