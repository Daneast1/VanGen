import { useState, useCallback, useRef } from 'react';

type BalanceState = {
  value: string | null;
  loading: boolean;
  error: boolean;
};

const MAX_CONCURRENT = 3;
const DELAY_MS = 500;

export function useBalanceChecker() {
  const [balances, setBalances] = useState<Map<string, BalanceState>>(new Map());
  const queueRef = useRef<{ address: string; network: 'btc' | 'eth' }[]>([]);
  const activeRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleNext = useCallback(() => {
    if (timerRef.current) return;
    if (activeRef.current >= MAX_CONCURRENT || queueRef.current.length === 0) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      processNext();
    }, DELAY_MS);
  }, []);

  const processNext = useCallback(async () => {
    if (activeRef.current >= MAX_CONCURRENT || queueRef.current.length === 0) return;

    const item = queueRef.current.shift()!;
    activeRef.current++;

    setBalances(prev => {
      const next = new Map(prev);
      next.set(item.address, { value: null, loading: true, error: false });
      return next;
    });

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
    scheduleNext();
  }, [scheduleNext]);

  const checkBalance = useCallback((address: string, network: 'btc' | 'eth') => {
    queueRef.current.push({ address, network });
    if (activeRef.current < MAX_CONCURRENT) {
      processNext();
    } else {
      scheduleNext();
    }
  }, [processNext, scheduleNext]);

  const getBalance = useCallback((address: string): BalanceState => {
    return balances.get(address) || { value: null, loading: false, error: false };
  }, [balances]);

  return { checkBalance, getBalance };
}

async function fetchWithTimeout(url: string, options?: RequestInit, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchEthBalance(address: string): Promise<string> {
  const errors: string[] = [];

  // Provider 1: Cloudflare ETH gateway (free, no key)
  try {
    const res = await fetchWithTimeout('https://cloudflare-eth.com', {
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
    if (data.error) throw new Error(data.error.message);
    const wei = BigInt(data.result);
    return formatWeiToEth(wei);
  } catch (e) {
    errors.push(`Cloudflare: ${e}`);
  }

  // Provider 2: Ankr public RPC (free, no key)
  try {
    const res = await fetchWithTimeout('https://rpc.ankr.com/eth', {
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
    if (data.error) throw new Error(data.error.message);
    const wei = BigInt(data.result);
    return formatWeiToEth(wei);
  } catch (e) {
    errors.push(`Ankr: ${e}`);
  }

  // Provider 3: PublicNode (free, no key)
  try {
    const res = await fetchWithTimeout('https://ethereum-rpc.publicnode.com', {
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
    if (data.error) throw new Error(data.error.message);
    const wei = BigInt(data.result);
    return formatWeiToEth(wei);
  } catch (e) {
    errors.push(`PublicNode: ${e}`);
  }

  throw new Error(`All providers failed: ${errors.join('; ')}`);
}

async function fetchBtcBalance(address: string): Promise<string> {
  const errors: string[] = [];

  // Provider 1: Blockchain.info (free, no key)
  try {
    const res = await fetchWithTimeout(`https://blockchain.info/q/addressbalance/${address}?confirmations=1`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const satoshis = BigInt(text.trim());
    return formatSatoshiToBtc(satoshis);
  } catch (e) {
    errors.push(`Blockchain.info: ${e}`);
  }

  // Provider 2: Blockstream (free, no key)
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

  throw new Error(`All providers failed: ${errors.join('; ')}`);
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
