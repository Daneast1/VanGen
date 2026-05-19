import { useState, useCallback } from 'react';

export interface TransactionSignature {
  r: string;
  s: string;
  v?: number;
  txHash: string;
  publicKey?: string;
  timestamp?: number;
}

export function useSignatureAnalyzer() {
  const [loading, setLoading] = useState(false);

  const getSignatures = useCallback(async (
    address: string,
    network: 'btc' | 'eth',
  ): Promise<TransactionSignature[] | null> => {
    setLoading(true);
    try {
      if (network === 'btc') {
        const url = `https://blockchain.info/rawaddr/${address}?limit=50`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.txs || data.txs.length === 0) return null;
        const sigs: TransactionSignature[] = [];
        for (const tx of data.txs) {
          for (const input of tx.inputs || []) {
            if (input.script) {
              const decoded = decodeDerSignatureFromScript(input.script);
              if (decoded) {
                sigs.push({ ...decoded, txHash: tx.hash, timestamp: tx.time });
              }
            }
          }
        }
        return sigs.length > 0 ? sigs : null;
      }
      if (network === 'eth') {
        const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || '';
        const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${address}&sort=desc&apikey=${apiKey}`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data.status !== '1' || !data.result || data.result.length === 0) return null;
        const sigs: TransactionSignature[] = [];
        for (const tx of data.result.slice(0, 20)) {
          const rawTxUrl = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${tx.hash}&apikey=${apiKey}`;
          const rawResp = await fetch(rawTxUrl);
          if (!rawResp.ok) continue;
          const rawData = await rawResp.json();
          if (rawData.result && rawData.result.r && rawData.result.s) {
            sigs.push({
              r: rawData.result.r.replace('0x', ''),
              s: rawData.result.s.replace('0x', ''),
              v: parseInt(rawData.result.v, 16),
              txHash: tx.hash,
              timestamp: parseInt(tx.timeStamp, 10),
            });
          }
        }
        return sigs.length > 0 ? sigs : null;
      }
      return null;
    } catch (err) {
      console.error('[SignatureAnalyzer] Error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { getSignatures, loading };
}

function decodeDerSignatureFromScript(scriptHex: string): { r: string; s: string } | null {
  try {
    const bytes = new Uint8Array(scriptHex.length / 2);
    for (let i = 0; i < scriptHex.length; i += 2) bytes[i / 2] = parseInt(scriptHex.slice(i, i + 2), 16);
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
  } catch { return null; }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
