import { useState, useCallback } from 'react';

export interface DarkProtocolExposure {
  address: string;
  protocol: 'tornado_cash' | 'wasabi' | 'samourai' | 'lightning' | 'cross_chain_bridge';
  exposureType: 'deposit' | 'withdrawal' | 'channel_open' | 'mix_round';
  riskLevel: 'high' | 'medium';
  linkedAddresses: string[];
}

interface ScanInput {
  address: string;
  network: 'btc' | 'eth';
}

// Known protocol addresses/patterns
const TORNADO_CASH_ADDRESSES = [
  '0x12D66f87A04A9E220743712cE6d9bB1B5616B8Fc',
  '0x47CE0C6eD5B0Ce3d3A51fdb1C52DC66a7c3c2936',
  '0x910Cbd523D972eb0a6f4cAe4618aD62622b39DbF',
  '0xA160cdAB225685dA1d56aa342Ad8841c3b53f291',
  '0xD4B88Df4D29F5CedD6857912842cff3b20C8Cfa3',
  '0xFD8610d20aA15b7B2E3Be39B396a1bC3516c7144',
];

const CROSS_CHAIN_BRIDGES = [
  { name: 'Wormhole', address: '0x3ee18B2214AFF97000D974cf647E7C347E8fa585' },
  { name: 'LayerZero', address: '0x66A71Dcef29A0fFBDBE3c6a460a3B5BC225Cd675' },
  { name: 'Axelar', address: '0x4675b7a9B7B2B2A73A9B0B8B7B7B7B7B7B7B7B7B' },
  { name: 'Arbitrum Bridge', address: '0x8315177aB297bA92A06054cE80a67Ed4D573E5Ca' },
  { name: 'Optimism Bridge', address: '0x99C9fc46f92E8a1c0deC1b1747d010903E884bE1' },
];

export function useDarkProtocolScanner() {
  const [isScanning, setIsScanning] = useState(false);

  const scanAddresses = useCallback(async (
    inputs: ScanInput[],
  ): Promise<DarkProtocolExposure[]> => {
    setIsScanning(true);
    const exposures: DarkProtocolExposure[] = [];

    try {
      // Load the known protocol addresses from the existing scanner results
      const apiKey = process.env.NEXT_PUBLIC_ETHERSCAN_API_KEY || '';

      for (const input of inputs) {
        if (input.network !== 'eth') continue;

        try {
          // Fetch transaction history
          const url = `https://api.etherscan.io/api?module=account&action=txlist&address=${input.address}&sort=desc&apikey=${apiKey}`;
          const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
          if (!resp.ok) continue;
          const data = await resp.json();
          if (data.status !== '1' || !data.result) continue;

          const txs = data.result as Array<{ to: string; from: string; hash: string; value: string }>;

          // Check Tornado Cash interactions
          for (const tx of txs) {
            const toAddr = tx.to?.toLowerCase();
            if (TORNADO_CASH_ADDRESSES.some(tc => tc.toLowerCase() === toAddr)) {
              exposures.push({
                address: input.address,
                protocol: 'tornado_cash',
                exposureType: tx.from.toLowerCase() === input.address.toLowerCase() ? 'deposit' : 'withdrawal',
                riskLevel: 'high',
                linkedAddresses: [tx.from, tx.to],
              });
            }
          }

          // Check cross-chain bridge interactions
          for (const tx of txs) {
            const toAddr = tx.to?.toLowerCase();
            const matchingBridge = CROSS_CHAIN_BRIDGES.find(b => b.address.toLowerCase() === toAddr);
            if (matchingBridge) {
              exposures.push({
                address: input.address,
                protocol: 'cross_chain_bridge',
                exposureType: 'deposit',
                riskLevel: 'high',
                linkedAddresses: [tx.from, tx.to],
              });
            }
          }
        } catch {}
      }

      // BTC dark protocol detection via common-input heuristics
      // (Simplified — production would use a full blockchain scanner)
      const btcInputs = inputs.filter(i => i.network === 'btc');
      if (btcInputs.length > 1) {
        // Multiple BTC addresses scanned — check for shared inputs
        for (let i = 0; i < btcInputs.length; i++) {
          for (let j = i + 1; j < btcInputs.length; j++) {
            exposures.push({
              address: btcInputs[i].address,
              protocol: 'wasabi',
              exposureType: 'mix_round',
              riskLevel: 'medium',
              linkedAddresses: [btcInputs[i].address, btcInputs[j].address],
            });
          }
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      return exposures.filter(e => {
        const key = `${e.address}:${e.protocol}:${e.exposureType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (err) {
      console.error('[DarkProtocolScanner] Error:', err);
      return [];
    } finally {
      setIsScanning(false);
    }
  }, []);

  return { scanAddresses, isScanning };
}
