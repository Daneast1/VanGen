import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bech32 } from 'bech32';
import bs58 from 'bs58';

let running = false;
let extraEntropy: Uint8Array | null = null;

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
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function generatePrivateKey(): Uint8Array {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  if (extraEntropy) {
    for (let i = 0; i < 32; i++) {
      key[i] ^= extraEntropy[i % extraEntropy.length];
    }
  }
  return key;
}

function deriveBtcAddress(privKey: Uint8Array, type: string): string {
  const pubKey = secp256k1.getPublicKey(privKey, true);
  const pubKeyHash = hash160(pubKey);

  switch (type) {
    case 'p2pkh': {
      const payload = new Uint8Array(21);
      payload[0] = 0x00;
      payload.set(pubKeyHash, 1);
      return base58check(payload);
    }
    case 'p2sh': {
      const witnessScript = new Uint8Array(22);
      witnessScript[0] = 0x00;
      witnessScript[1] = 0x14;
      witnessScript.set(pubKeyHash, 2);
      const scriptHash = hash160(witnessScript);
      const payload = new Uint8Array(21);
      payload[0] = 0x05;
      payload.set(scriptHash, 1);
      return base58check(payload);
    }
    case 'bech32': {
      const words = bech32.toWords(pubKeyHash);
      return bech32.encode('bc', [0, ...words]);
    }
    default:
      return '';
  }
}

function deriveEthAddress(privKey: Uint8Array): string {
  const pubKey = secp256k1.getPublicKey(privKey, false).slice(1);
  const hash = keccak_256(pubKey);
  const addressBytes = hash.slice(-20);
  const hexAddr = bytesToHex(addressBytes);

  // EIP-55 checksum
  const addrHashHex = bytesToHex(keccak_256(new TextEncoder().encode(hexAddr)));
  let checksummed = '0x';
  for (let i = 0; i < 40; i++) {
    checksummed += parseInt(addrHashHex[i], 16) >= 8
      ? hexAddr[i].toUpperCase()
      : hexAddr[i];
  }
  return checksummed;
}

self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'start': {
      running = true;
      const { network, prefix, suffix, addressType } = payload;
      const isCaseInsensitive = network === 'eth' || addressType === 'bech32';
      const prefixTarget = isCaseInsensitive ? (prefix || '').toLowerCase() : (prefix || '');
      const suffixTarget = isCaseInsensitive ? (suffix || '').toLowerCase() : (suffix || '');
      const hasPrefix = prefixTarget.length > 0;
      const hasSuffix = suffixTarget.length > 0;
      const isBtc = network === 'btc';

      // Pre-compute slice offset for address body extraction
      let sliceStart: number;
      if (!isBtc) sliceStart = 2;        // '0x'
      else if (addressType === 'bech32') sliceStart = 4; // 'bc1q'
      else sliceStart = 1;               // '1' or '3'

      let totalAttempts = 0;
      let batchAttempts = 0;
      let lastReport = performance.now();

      const loop = () => {
        if (!running) return;

        // Larger batch = less setTimeout overhead, more throughput
        const batchSize = 3000;
        for (let i = 0; i < batchSize; i++) {
          const privKey = generatePrivateKey();
          let address: string;

          try {
            address = isBtc ? deriveBtcAddress(privKey, addressType) : deriveEthAddress(privKey);
          } catch {
            continue;
          }

          batchAttempts++;
          totalAttempts++;

          // Fast match using pre-computed values
          const body = isCaseInsensitive ? address.slice(sliceStart).toLowerCase() : address.slice(sliceStart);

          if (hasPrefix && !body.startsWith(prefixTarget)) continue;
          if (hasSuffix && !body.endsWith(suffixTarget)) continue;

          // Found a match — verify by re-deriving
          const reAddress = isBtc ? deriveBtcAddress(privKey, addressType) : deriveEthAddress(privKey);
          if (reAddress === address) {
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
          }
        }

        const now = performance.now();
        if (now - lastReport >= 1000) {
          const elapsed = (now - lastReport) / 1000;
          self.postMessage({
            type: 'progress',
            payload: {
              attempts: totalAttempts,
              hashrate: Math.round(batchAttempts / elapsed),
            },
          });
          batchAttempts = 0;
          lastReport = now;
        }

        setTimeout(loop, 0);
      };

      loop();
      break;
    }
    case 'stop':
      running = false;
      break;
    case 'entropy':
      extraEntropy = sha256(new Uint8Array(payload));
      break;
  }
};
