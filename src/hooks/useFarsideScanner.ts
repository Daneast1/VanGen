import { useState, useCallback } from 'react';

export interface FarsideExposure {
  address: string;
  chain: string;
  vulnerability: string;
  originalNetwork: 'btc' | 'eth';
  keyShared: boolean;
}

export function useFarsideScanner() {
  const [isScanning, setIsScanning] = useState(false);

  const scan = useCallback(async (
    scanResults: Array<{ address: string; network: 'btc' | 'eth'; privateKey?: string }>,
  ): Promise<FarsideExposure[]> => {
    setIsScanning(true);
    const exposures: FarsideExposure[] = [];

    try {
      const sidechains = [
        { name: 'RSK', prefix: '0x', network: 'btc' as const },
        { name: 'Liquid', prefix: 'V', network: 'btc' as const },
        { name: 'Stacks', prefix: 'SP', network: 'btc' as const },
        { name: 'Arbitrum', prefix: '0x', network: 'eth' as const },
        { name: 'Optimism', prefix: '0x', network: 'eth' as const },
        { name: 'Base', prefix: '0x', network: 'eth' as const },
        { name: 'Polygon', prefix: '0x', network: 'eth' as const },
        { name: 'Avalanche C-Chain', prefix: '0x', network: 'eth' as const },
        { name: 'BNB Smart Chain', prefix: '0x', network: 'eth' as const },
      ];

      // Check for address reuse patterns that indicate shared keys across chains
      for (const result of scanResults) {
        for (const sidechain of sidechains) {
          if (sidechain.network === result.network) continue;

          // Check if the same address format could exist on the sidechain
          if (result.address.startsWith(sidechain.prefix)) {
            exposures.push({
              address: result.address,
              chain: sidechain.name,
              vulnerability: `Address format matches ${sidechain.name}. If the same private key is used, funds on ${sidechain.name} are compromisable.`,
              originalNetwork: result.network,
              keyShared: true,
            });
          }
        }
      }

      // Check for reuse patterns across Bitcoin-derived chains
      const btcResults = scanResults.filter(r => r.network === 'btc');
      for (const result of btcResults) {
        // BTC address could map to Bitcoin Cash (same format)
        exposures.push({
          address: result.address,
          chain: 'Bitcoin Cash',
          vulnerability: 'BCH uses same address format as BTC. Key reuse across BCH would expose funds.',
          originalNetwork: 'btc',
          keyShared: true,
        });

        // BTC address could map to Bitcoin SV
        exposures.push({
          address: result.address,
          chain: 'Bitcoin SV',
          vulnerability: 'BSV uses same ECDSA curve and address format. Key reuse possible.',
          originalNetwork: 'btc',
          keyShared: true,
        });

        // Litecoin (starts with L or M)
        if (result.address.startsWith('1')) {
          exposures.push({
            address: result.address,
            chain: 'Litecoin',
            vulnerability: 'LTC P2PKH addresses start with L. If the same private key was used with LTC prefix, funds may be exposed.',
            originalNetwork: 'btc',
            keyShared: false,
          });
        }
      }

      // Deduplicate
      const seen = new Set<string>();
      return exposures.filter(e => {
        const key = `${e.address}:${e.chain}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    } catch (err) {
      console.error('[FarsideScanner] Error:', err);
      return [];
    } finally {
      setIsScanning(false);
    }
  }, []);

  return { scan, isScanning };
}
