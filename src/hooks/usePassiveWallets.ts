/**
 * usePassiveWallets
 *
 * Stores auto-collected wallet addresses from the Vanity Generator and
 * Vulnerability Scanner into localStorage in append-only chunks.
 *
 * Design goals:
 *  - Never loads the full address list into React state (supports millions).
 *  - Only tracks a count in state so re-renders stay cheap.
 *  - Persists across page reloads.
 *  - addAddresses() is idempotent — duplicates are ignored via a bloom-like
 *    Set stored in memory (resets on hard reload, but that's fine; worst case
 *    a duplicate slips in across sessions, which is harmless).
 */

import { useState, useCallback, useEffect, useRef } from 'react';

const COUNT_KEY = 'passive_wallets_count';
const CHUNK_PREFIX = 'passive_wallets_chunk_';
const CHUNK_SIZE = 500; // addresses per localStorage entry

function readCount(): number {
  try {
    return parseInt(localStorage.getItem(COUNT_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function writeCount(n: number) {
  try {
    localStorage.setItem(COUNT_KEY, String(n));
  } catch {
    // storage quota exceeded — ignore silently
  }
}

function currentChunkIndex(count: number): number {
  return Math.floor(count / CHUNK_SIZE);
}

function readChunk(idx: number): string[] {
  try {
    const raw = localStorage.getItem(`${CHUNK_PREFIX}${idx}`);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeChunk(idx: number, chunk: string[]) {
  try {
    localStorage.setItem(`${CHUNK_PREFIX}${idx}`, JSON.stringify(chunk));
  } catch {
    // quota exceeded — data loss is acceptable here
  }
}

export interface PassiveWallet {
  address: string;
  privateKey: string;
  network: 'btc' | 'eth';
  addressType: string;
  source: 'vanity' | 'scanner';
  timestamp: number;
}

export function usePassiveWallets() {
  const [count, setCount] = useState<number>(readCount);
  // In-memory dedup set — only tracks addresses seen since page load
  const seenRef = useRef<Set<string>>(new Set());

  // Sync count from storage on mount (in case another tab wrote)
  useEffect(() => {
    const stored = readCount();
    setCount(stored);
  }, []);

  const addAddresses = useCallback((wallets: PassiveWallet[]) => {
    if (wallets.length === 0) return;

    const fresh = wallets.filter(w => !seenRef.current.has(w.address));
    if (fresh.length === 0) return;

    fresh.forEach(w => seenRef.current.add(w.address));

    let currentCount = readCount();

    for (const wallet of fresh) {
      const chunkIdx = currentChunkIndex(currentCount);
      const chunk = readChunk(chunkIdx);
      // Store compact: "address|privKey|network|addrType|source|timestamp"
      chunk.push(
        [wallet.address, wallet.privateKey, wallet.network, wallet.addressType, wallet.source, wallet.timestamp].join('|')
      );
      writeChunk(chunkIdx, chunk);
      currentCount++;
    }

    writeCount(currentCount);
    setCount(currentCount);
  }, []);

  const clearAll = useCallback(() => {
    const currentCount = readCount();
    const totalChunks = Math.ceil(currentCount / CHUNK_SIZE) + 1;
    for (let i = 0; i <= totalChunks; i++) {
      try {
        localStorage.removeItem(`${CHUNK_PREFIX}${i}`);
      } catch {
        // ignore
      }
    }
    writeCount(0);
    seenRef.current.clear();
    setCount(0);
  }, []);

  return { count, addAddresses, clearAll };
}
