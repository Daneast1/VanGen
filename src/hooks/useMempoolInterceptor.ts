import { useState, useCallback, useRef } from 'react';

export interface MempoolTransaction {
  txHash: string;
  address: string;
  network: 'btc' | 'eth';
  r: string;
  s: string;
  v?: number;
  value?: string;
  timestamp: number;
}

export interface MempoolAlert {
  txHash: string;
  address: string;
  network: 'btc' | 'eth';
  vulnerabilityType: string;
  timestamp: number;
  privateKey?: string;
  value?: string;
  status: 'detected' | 'sweeping' | 'swept' | 'missed';
}

export function useMempoolInterceptor() {
  const [connected, setConnected] = useState(false);
  const [pendingTxs, setPendingTxs] = useState<MempoolTransaction[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const intervalRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    if (connected) return;
    setConnected(true);
  }, [connected]);

  const disconnect = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setConnected(false);
  }, []);

  const scanMempool = useCallback(async (): Promise<MempoolAlert[]> => {
    const alerts: MempoolAlert[] = [];

    try {
      // Scan Bitcoin mempool via blockchain.info
      const btcResp = await fetch('https://blockchain.info/unconfirmed-transactions?format=json', {
        signal: AbortSignal.timeout(5000),
      });
      if (btcResp.ok) {
        const btcData = await btcResp.json();
        const txs = btcData.txs || [];
        for (const tx of txs.slice(0, 50)) {
          // Look for potential nonce reuse patterns
          for (const input of tx.inputs || []) {
            if (input.script) {
              const decoded = decodeDerFromScript(input.script);
              if (decoded) {
                // Check for short nonces (< 248 bits)
                const rBits = hexToBigIntBits(decoded.r);
                const sBits = hexToBigIntBits(decoded.s);
                if (rBits < 248 || sBits < 248) {
                  alerts.push({
                    txHash: tx.hash,
                    address: input.prev_out?.addr || 'unknown',
                    network: 'btc',
                    vulnerabilityType: rBits < 248 ? 'short_nonce' : 'biased_nonce',
                    timestamp: Date.now(),
                    value: input.prev_out?.value ? `${(input.prev_out.value / 1e8).toFixed(8)} BTC` : undefined,
                    status: 'detected',
                  });
                }
              }
            }
          }
        }
      }
    } catch {}

    try {
      // Scan Ethereum mempool via Etherscan pending txs
      const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || '';
      const ethResp = await fetch(
        `https://api.etherscan.io/api?module=proxy&action=eth_getBlockByNumber&tag=pending&boolean=true&apikey=${apiKey}`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (ethResp.ok) {
        const ethData = await ethResp.json();
        const txs = ethData.result?.transactions || [];
        for (const tx of txs.slice(0, 50)) {
          if (tx.r && tx.s) {
            const r = tx.r.startsWith('0x') ? tx.r.slice(2) : tx.r;
            const s = tx.s.startsWith('0x') ? tx.s.slice(2) : tx.s;
            const rBits = hexToBigIntBits(r);
            const sBits = hexToBigIntBits(s);
            if (rBits < 248 || sBits < 248) {
              alerts.push({
                txHash: tx.hash,
                address: tx.from,
                network: 'eth',
                vulnerabilityType: rBits < 248 ? 'short_nonce' : 'biased_nonce',
                timestamp: Date.now(),
                value: tx.value ? `${parseInt(tx.value, 16) / 1e18} ETH` : undefined,
                status: 'detected',
              });
            }
          }
        }
      }
    } catch {}

    return alerts;
  }, []);

  return {
    connect,
    disconnect,
    scanMempool,
    connected,
    pendingTxs,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function decodeDerFromScript(scriptHex: string): { r: string; s: string } | null {
  try {
    const bytes = new Uint8Array(scriptHex.length / 2);
    for (let i = 0; i < scriptHex.length; i += 2) {
      bytes[i / 2] = parseInt(scriptHex.slice(i, i + 2), 16);
    }
    for (let i = 0; i < bytes.length; i++) {
      if (bytes[i] === 0x30) {
        const seqLen = bytes[i + 1];
        if (i + 2 + seqLen > bytes.length) continue;
        let pos = i + 2;
        if (bytes[pos] !== 0x02) continue;
        const rLen = bytes[pos + 1];
        const rBytes = bytes.slice(pos + 2, pos + 2 + rLen);
        pos = pos + 2 + rLen;
        if (bytes[pos] !== 0x02) continue;
        const sLen = bytes[pos + 1];
        const sBytes = bytes.slice(pos + 2, pos + 2 + sLen);
        return { r: bytesToHex(rBytes), s: bytesToHex(sBytes) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function hexToBigIntBits(hex: string): number {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bigVal = BigInt('0x' + clean);
  return bigVal.toString(2).length;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
