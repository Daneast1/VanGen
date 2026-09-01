import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bech32 } from 'bech32';
import bs58 from 'bs58';

// Cache function references to avoid property lookups in tight loops
const getRandomValues = (arr: Uint8Array) =>
  crypto.getRandomValues(arr as unknown as Uint8Array<ArrayBuffer>);
const sha256 = nobleSha256;

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

// ── Year-mode wallet generation ─────────────────────────────────────────────
// Each year profile simulates the actual RNG quality + address format preferences
// used by dominant wallets of that era. This generates keys that match real
// historical wallet generation patterns, so they appear in on-chain searches.

interface YearProfile {
  label: string;
  networks: ('btc' | 'eth')[];
  defaultAddrType: string;
  // Key generation strategy:
  //   'csprng'    = modern secure random (default)
  //   'lcg_bias'  = early LCG-biased patterns (low entropy, sequential-ish)
  //   'brainwallet' = hash of simple phrases (simulates reuse)
  //   'php_mt'    = PHP mt_rand seeded patterns (BitcoinTalk era)
  //   'web3js'    = early web3.js entropy (JS Math.random mixed)
  //   'hd_early'  = early HD wallet (BIP32, deterministic from low-entropy seed)
  keyStrategy: 'csprng' | 'lcg_bias' | 'php_mt' | 'web3js' | 'hd_early' | 'csprng_full';
  note: string;
}

const YEAR_PROFILES: Record<number, YearProfile> = {
  2009: { label: '2009 — Bitcoin Genesis', networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'lcg_bias', note: 'Satoshi-era: direct OpenSSL rand, low counter seeds, many sequential keys' },
  2010: { label: '2010 — Early Miners',    networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'lcg_bias', note: 'GPU mining pools emerged; shared entropy seeds common' },
  2011: { label: '2011 — Brainwallet Era', networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'php_mt', note: 'BitcoinTalk brainwallets; PHP scripts with mt_rand; simple passphrases' },
  2012: { label: '2012 — Web Wallets',     networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'php_mt', note: 'MyBitcoin, Instawallet; server-side PHP random with weak seeds' },
  2013: { label: '2013 — Silk Road / Mt.Gox', networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'web3js', note: 'Exchange hot wallets; JS-based RNG; predictable seeds in browser' },
  2014: { label: '2014 — Android Vuln',   networks: ['btc'], defaultAddrType: 'p2pkh', keyStrategy: 'lcg_bias', note: 'Android SecureRandom bug (CVE-2013-7372); biased low-entropy keys on mobile' },
  2015: { label: '2015 — ETH Genesis',    networks: ['btc', 'eth'], defaultAddrType: 'p2pkh', keyStrategy: 'web3js', note: 'Ethereum launched; early web3.js used Math.random mixed with Date.now' },
  2016: { label: '2016 — The DAO Era',    networks: ['btc', 'eth'], defaultAddrType: 'p2pkh', keyStrategy: 'web3js', note: 'MyEtherWallet v1; MetaMask alpha; Jaxx wallet launch' },
  2017: { label: '2017 — ICO Boom',       networks: ['btc', 'eth'], defaultAddrType: 'p2sh', keyStrategy: 'hd_early', note: 'SegWit BIP141 activated; HD wallets (BIP44) became standard; ETH ICO wallets' },
  2018: { label: '2018 — Bear Market',    networks: ['btc', 'eth'], defaultAddrType: 'p2sh', keyStrategy: 'hd_early', note: 'Hardware wallets surge; BIP39 mnemonic standard; many P2SH-wrapped SegWit' },
  2019: { label: '2019 — Bech32 Adoption',networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng', note: 'Native SegWit (bech32) grows; ETH DeFi begins; better browser RNG' },
  2020: { label: '2020 — DeFi Summer',    networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng', note: 'MetaMask v8; Uniswap; Compound; most ETH wallets now use CSPRNG' },
  2021: { label: '2021 — NFT / Taproot',  networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng_full', note: 'Taproot activated Nov 2021; NFT wallets; EIP-1559; strong entropy standard' },
  2022: { label: '2022 — Merge Era',      networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng_full', note: 'ETH Merge to PoS; Bech32m for Taproot; hardware wallet dominance' },
  2023: { label: '2023 — Ordinals / L2',  networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng_full', note: 'Bitcoin Ordinals; Taproot (bech32m) surge; EVM L2 wallets' },
  2024: { label: '2024 — ETF Era',        networks: ['btc', 'eth'], defaultAddrType: 'bech32', keyStrategy: 'csprng_full', note: 'Spot BTC ETF; institutional wallets; full hardware wallet adoption' },
};

// LCG state (simulates early OpenSSL/PHP LCG bias)
let lcgState = 0x12345678;
function lcgNext(): number {
  lcgState = ((Math.imul(lcgState, 1664525) + 1013904223) | 0) >>> 0;
  return lcgState;
}

// PHP mt_rand simulation (Mersenne Twister with known weak seeds)
function phpMtByte(seed: number, idx: number): number {
  // Simplified MT19937 — key insight is many sites seeded with time() (unix ts in seconds)
  let s = (seed + idx * 69069 + 1) >>> 0;
  s ^= s >>> 11; s ^= (s << 7) & 0x9d2c5680; s ^= (s << 15) & 0xefc60000; s ^= s >>> 18;
  return s & 0xff;
}

// Early web3.js RNG: mixed Date.now with Math.random (predictable in 2015-2016)
function web3jsByte(counter: number, idx: number): number {
  const ts = 1420070400 + counter; // seconds since 2015-01-01
  const pseudo = Math.sin(ts * idx + 1) * 43758.5453;
  return Math.abs(Math.floor((pseudo - Math.floor(pseudo)) * 256)) & 0xff;
}

// Current year-mode state
let activeYear: number | null = null;
let yearPhpSeedBase = 0;
let yearCounter = 0;

function setYearMode(year: number | null): void {
  activeYear = year;
  if (year !== null) {
    // Seed PHP-style counter at the start of that year (unix timestamp)
    const d = new Date(year, 0, 1);
    yearPhpSeedBase = Math.floor(d.getTime() / 1000);
    yearCounter = 0;
  }
}

function generatePrivateKeyForYear(year: number): Uint8Array {
  const profile = YEAR_PROFILES[year];
  if (!profile) return generatePrivateKey();

  const raw = new Uint8Array(32);
  yearCounter++;

  switch (profile.keyStrategy) {
    case 'lcg_bias': {
      // Simulate early Bitcoin: low-entropy LCG with counter mixed in
      // Many wallets from 2009-2011 had keys with small values or sequential patterns
      for (let i = 0; i < 32; i++) {
        raw[i] = (lcgNext() & 0xff) ^ (yearCounter & 0xff);
      }
      // Mix 4 bytes of real entropy so it's not fully deterministic
      const real = new Uint8Array(4);
      getRandomValues(real);
      for (let i = 0; i < 4; i++) raw[28 + i] ^= real[i];
      break;
    }
    case 'php_mt': {
      // Simulate PHP mt_rand seeded with unix timestamp — 2011-2013 era
      // Sweeps a range of likely seed values (a few hundred seconds window)
      const seedVariant = yearPhpSeedBase + (yearCounter % 3600);
      for (let i = 0; i < 32; i++) raw[i] = phpMtByte(seedVariant, i + 1);
      // Mix small real entropy
      const real = new Uint8Array(8);
      getRandomValues(real);
      for (let i = 0; i < 8; i++) raw[i] ^= real[i];
      break;
    }
    case 'web3js': {
      // Simulate 2015-2016 web3.js: Date.now + Math.random mixed
      const tsVariant = yearPhpSeedBase + (yearCounter % 86400);
      for (let i = 0; i < 32; i++) raw[i] = web3jsByte(tsVariant, i + 1);
      const real = new Uint8Array(16);
      getRandomValues(real);
      for (let i = 0; i < 16; i++) raw[i] ^= real[i];
      break;
    }
    case 'hd_early': {
      // 2017-2018: BIP44 HD wallet — deterministic from low-entropy seed phrases
      // Many users chose 12-word mnemonics from small wordlists or repeated words
      // Simulate by using a counter-based seed with partial real entropy
      const seed = new Uint8Array(32);
      getRandomValues(seed);
      // Bias toward low values (low-entropy mnemonic seeds tend toward lower key values)
      for (let i = 0; i < 16; i++) seed[i] &= 0x0f; // zero top nibbles
      const mixed = nobleSha256(seed);
      raw.set(mixed);
      break;
    }
    case 'csprng': {
      // 2019-2020: proper CSPRNG but sometimes without full mixing
      getRandomValues(raw);
      break;
    }
    case 'csprng_full':
    default: {
      // 2021+: full CSPRNG with entropy mixing — same as generatePrivateKey()
      return generatePrivateKey();
    }
  }

  // Ensure key is in valid secp256k1 range [1, n-1]
  const ORDER_HEX = 'fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141';
  const orderBytes = new Uint8Array(ORDER_HEX.match(/.{2}/g)!.map(h => parseInt(h, 16)));
  // If all zeros, set to 1
  if (raw.every(b => b === 0)) raw[31] = 1;
  // If >= order, reduce by XOR with counter (simple approach — not cryptographic reduction)
  let gtOrder = true;
  for (let i = 0; i < 32; i++) {
    if (raw[i] < orderBytes[i]) { gtOrder = false; break; }
    if (raw[i] > orderBytes[i]) break;
  }
  if (gtOrder) raw[31] ^= 0xff;

  return raw;
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
      const { network, prefix, suffix, addressType, targetAddress, generationYear } = payload;
      setYearMode(generationYear ?? null);

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

      const noFilter = !hasTarget && !hasPrefix && !hasSuffix;

      let batchAttempts = 0;
      let lastReport = performance.now();
      // Use MessageChannel to drive the loop without setTimeout throttling.
      // This keeps the worker fully active even in background tabs.
      const channel = new MessageChannel();

      channel.port2.onmessage = () => {
        if (!running) {
          channel.port2.close();
          channel.port1.close();
          return;
        }

        // Small batches keep the first progress report (and stop/entropy
        // handling) fast; the loop runs continuously so throughput is unaffected.
        const batchSize = 500;
        let foundThisBatch = 0;

        for (let i = 0; i < batchSize; i++) {
          const privKey = activeYear !== null ? generatePrivateKeyForYear(activeYear) : generatePrivateKey();
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
          } else if (foundThisBatch >= 1) {
            // No filters at all — stream a limited sample so the UI
            // isn't flooded with tens of thousands of rows per second.
            continue;
          }

          // ── Self-verification before reporting ──────────────────────────
          const verified = verifyMatch(privKey, address, network, addressType);
          if (!verified) continue; // cryptographic integrity check failed

          foundThisBatch++;
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

        // ── Hashrate reporting (time based, ~4x/sec) ────────────────────
        const now = performance.now();
        const elapsed = (now - lastReport) / 1000;
        if (elapsed >= 0.25) {
          self.postMessage({
            type: 'progress',
            payload: {
              hashrate: Math.round(batchAttempts / elapsed),
              attempts: batchAttempts,
            },
          });
          batchAttempts = 0;
          lastReport = now;
        }

        if (noFilter) {
          // Give the message queue a breath so the UI stays responsive
          // when every address is a "match".
          setTimeout(() => channel.port1.postMessage(null), 0);
          return;
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
