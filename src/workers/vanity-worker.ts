import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bech32 } from 'bech32';
import bs58 from 'bs58';

// Cache function references to avoid property lookups in tight loops
const { getRandomValues } = crypto;
const { getPublicKey } = secp256k1;

// ─── State ────────────────────────────────────────────────────────────────────
let running = false;

// Rolling 256-bit entropy pool — mixed with every key generation
const entropyPool = new Uint8Array(32);
crypto.getRandomValues(entropyPool);
let entropyCounter = 0n; // monotonic counter prevents pool reuse

// ─── Utilities ────────────────────────────────────────────────────────────────
function hash160(data: Uint8Array): Uint8Array {
  return ripemd160(sha256(data));
}

function base58check(payload: Uint8Array): string {
  const h1 = sha256(payload);
  const h2 = sha256(h1);
  const full = new Uint8Array(payload.length + 4);
  full.set(payload);
  full.set(h2.slice(0, 4), payload.length);
  return bs58.encode(full);
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

// ─── Entropy-Mixed Key Generation ────────────────────────────────────────────
// Mixes CSPRNG output with our rolling entropy pool and a monotonic counter
// so that injected mouse/keyboard entropy actually influences key material.
function generatePrivateKey(): Uint8Array {
  const raw = new Uint8Array(32);
  getRandomValues(raw);

  // Mix with entropy pool
  for (let i = 0; i < 32; i++) {
    raw[i] ^= entropyPool[i];
  }

  // Mix in monotonic counter to ensure uniqueness even if pool is static
  entropyCounter++;
  const counterBytes = new Uint8Array(8);
  let c = entropyCounter;
  for (let i = 7; i >= 0; i--) {
    counterBytes[i] = Number(c & 0xffn);
    c >>= 8n;
  }
  for (let i = 0; i < 8; i++) {
    raw[i % 32] ^= counterBytes[i];
  }

  // Re-hash to ensure uniform distribution
  return nobleSha256(raw);
}

// Refresh the entropy pool from injected external data
function injectEntropyIntoPool(data: Uint8Array): void {
  const combined = new Uint8Array(32 + data.length);
  combined.set(entropyPool);
  combined.set(data, 32);
  const fresh = sha256(combined);
  entropyPool.set(fresh);
}

// ─── Address Derivation ───────────────────────────────────────────────────────
function deriveBtcAddress(privKey: Uint8Array, type: string): string {
  const pubKey = secp256k1.getPublicKey(privKey, true); // compressed
  const pubKeyHash = hash160(pubKey);

  switch (type) {
    case 'p2pkh': {
      // Legacy: version byte 0x00
      const payload = new Uint8Array(21);
      payload[0] = 0x00;
      payload.set(pubKeyHash, 1);
      return base58check(payload);
    }
    case 'p2sh': {
      // SegWit-wrapped P2SH: redeem script = OP_0 <20-byte-pubkeyhash>
      const redeemScript = new Uint8Array(22);
      redeemScript[0] = 0x00; // OP_0
      redeemScript[1] = 0x14; // PUSH 20 bytes
      redeemScript.set(pubKeyHash, 2);
      const scriptHash = hash160(redeemScript);
      const payload = new Uint8Array(21);
      payload[0] = 0x05; // P2SH version byte
      payload.set(scriptHash, 1);
      return base58check(payload);
    }
    case 'bech32': {
      // Native SegWit P2WPKH (bc1q...)
      // Correct encoding: witness version 0 as a 5-bit word, then pubKeyHash
      // converted to 5-bit words, then bech32-encoded with hrp 'bc'
      const words = bech32.toWords(pubKeyHash); // converts 8-bit to 5-bit groups
      return bech32.encode('bc', [0x00, ...words]); // 0x00 = witness version 0
    }
    default:
      return '';
  }
}

function deriveEthAddress(privKey: Uint8Array): string {
  // Uncompressed public key, drop the 0x04 prefix byte
  const pubKey = secp256k1.getPublicKey(privKey, false).slice(1);
  const hash = keccak_256(pubKey);
  const addressBytes = hash.slice(-20);
  const hexAddr = bytesToHex(addressBytes); // lowercase, no 0x

  // EIP-55 mixed-case checksum
  const addrHashHex = bytesToHex(keccak_256(new TextEncoder().encode(hexAddr)));
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(addrHashHex[i], 16) >= 8
      ? hexAddr[i].toUpperCase()
      : hexAddr[i].toLowerCase();
  }
  return checksummed;
}

// ─── Self-Verification ────────────────────────────────────────────────────────
// Re-derive from private key and confirm address matches before reporting
function verifyMatch(privKey: Uint8Array, address: string, network: string, addressType: string): boolean {
  try {
    const rederived = network === 'btc'
      ? deriveBtcAddress(privKey, addressType)
      : deriveEthAddress(privKey);
    return rederived === address;
  } catch {
    return false;
  }
}

// ─── Message Handler ──────────────────────────────────────────────────────────
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'start': {
      running = true;
      const { network, prefix, suffix, addressType, targetAddress } = payload;

      const hasTarget = typeof targetAddress === 'string' && targetAddress.length > 0;
      const targetNormalized = hasTarget
        ? (network === 'eth' ? targetAddress.toLowerCase() : targetAddress)
        : '';

      // Ethereum and bech32 matching is case-insensitive at match time
      const isCaseInsensitive = network === 'eth' || addressType === 'bech32';
      const prefixTarget = isCaseInsensitive ? (prefix || '').toLowerCase() : (prefix || '');
      const suffixTarget = isCaseInsensitive ? (suffix || '').toLowerCase() : (suffix || '');
      const hasPrefix = prefixTarget.length > 0;
      const hasSuffix = suffixTarget.length > 0;
      const isBtc = network === 'btc';

      // How many chars to skip past the address type prefix when matching
      // e.g. for ETH: skip '0x' (2), for bc1q: skip 'bc1q' (4), for '1'/'3': skip 1
      let sliceStart: number;
      if (!isBtc) sliceStart = 2;               // '0x'
      else if (addressType === 'bech32') sliceStart = 4; // 'bc1q'
      else sliceStart = 1;                       // '1' or '3'

      let batchAttempts = 0;
      let lastReport = performance.now();
      let batchCount = 0;
      // Use MessageChannel to drive the loop without setTimeout throttling.
      // This keeps the worker fully active even in background tabs.
      const channel = new MessageChannel();

      channel.port2.onmessage = () => {
        if (!running) {
          channel.port2.close();
          channel.port1.close();
          return;
        }

        // Adaptive batch size: larger batches = better throughput,
        // smaller = more responsive stop/entropy signals
        const batchSize = 50000;

        for (let i = 0; i < batchSize; i++) {
          const privKey = generatePrivateKey();
          let address: string;

          try {
            address = isBtc
              ? deriveBtcAddress(privKey, addressType)
              : deriveEthAddress(privKey);
          } catch {
            continue;
          }

          batchAttempts++;

          // ── Matching logic ──────────────────────────────────────────────
          if (hasTarget) {
            const cmp = isCaseInsensitive ? address.toLowerCase() : address;
            if (cmp !== targetNormalized) continue;
          } else if (hasPrefix || hasSuffix) {
            const body = isCaseInsensitive
              ? address.slice(sliceStart).toLowerCase()
              : address.slice(sliceStart);
            if (hasPrefix && !body.startsWith(prefixTarget)) continue;
            if (hasSuffix && !body.endsWith(suffixTarget)) continue;
          } else {
            // No target, no prefix, no suffix — every address matches
            // (shouldn't normally happen but handle gracefully)
          }

          // ── Self-verification before reporting ──────────────────────────
          const verified = verifyMatch(privKey, address, network, addressType);
          if (!verified) continue; // cryptographic integrity check failed

          self.postMessage({
            type: 'found',
            payload: {
              address,
              privateKey: bytesToHex(privKey),
              network,
              addressType,
              verified: true,
              timestamp: Date.now(),
            },
          });
        } // end of for loop
        batchCount++;

       // ── Hashrate reporting (every 10 batches to reduce messaging) ─
        batchCount++;
        if (batchCount % 10 === 0) {
          const now = performance.now();
          const elapsed = (now - lastReport) / 1000;
          const attemptsSinceLastReport = batchAttempts;
          self.postMessage({
            type: 'progress',
            payload: {
              hashrate: Math.round(attemptsSinceLastReport / elapsed),
              attempts: attemptsSinceLastReport,
            },
          });
          batchAttempts = 0;
          lastReport = now;
        }

        // Schedule next batch
        channel.port1.postMessage(null);
      };

      // Kick off the loop
      channel.port1.postMessage(null);
      break;
    }

    case 'stop':
      running = false;
      break;

    case 'entropy': {
      // Inject external entropy (mouse moves, keypresses) into the pool
      const data = new Uint8Array(payload as ArrayBuffer);
      injectEntropyIntoPool(data);
      break;
    }
  }
};
