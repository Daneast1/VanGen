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
    // Process next items
    processNext();
  }, []);

  const checkBalance = useCallback((address: string, network: 'btc' | 'eth') => {
    queueRef.current.push({ address, network });
    processNext();
  }, [processNext]);

  const getBalance = useCallback((address: string): BalanceState => {
    return balances.get(address) || { value: null, loading: false, error: false };
  }, [balances]);

  return { checkBalance, getBalance };
}

async function fetchEthBalance(address: string): Promise<string> {
  const errors: string[] = [];

  try {
    const res = await fetch('https://eth-mainnet.g.alchemy.com/v2/demo', {
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
    errors.push(`Alchemy: ${e}`);
  }

  try {
    const res = await fetch(`https://api.blockcypher.com/v1/eth/main/addrs/${address}/balance`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const wei = BigInt(data.balance);
    return formatWeiToEth(wei);
  } catch (e) {
    errors.push(`Blockcypher: ${e}`);
  }

  throw new Error(`All providers failed: ${errors.join('; ')}`);
}

async function fetchBtcBalance(address: string): Promise<string> {
  const errors: string[] = [];

  try {
    const res = await fetch(`https://api.blockcypher.com/v1/btc/main/addrs/${address}/balance`);
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
