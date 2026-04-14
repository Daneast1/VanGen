import { useState, useRef, useCallback, useEffect } from 'react';

export interface FoundAddress {
  address: string;
  privateKey: string;
  network: 'btc' | 'eth';
  addressType: string;
  verified: boolean;
  timestamp: number;
}

interface GeneratorConfig {
  network: 'btc' | 'eth';
  prefix: string;
  suffix: string;
  addressType: string;
}

export function useVanityGenerator() {
  const [isRunning, setIsRunning] = useState(false);
  const [hashrate, setHashrate] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [results, setResults] = useState<FoundAddress[]>([]);
  const workersRef = useRef<Worker[]>([]);
  const configRef = useRef<GeneratorConfig | null>(null);

  const workerCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);

  const stop = useCallback(() => {
    workersRef.current.forEach(w => {
      w.postMessage({ type: 'stop' });
      w.terminate();
    });
    workersRef.current = [];
    setIsRunning(false);
  }, []);

  const start = useCallback((config: GeneratorConfig) => {
    stop();
    configRef.current = config;
    setIsRunning(true);
    setTotalAttempts(0);
    setHashrate(0);

    const workers: Worker[] = [];
    const rates = new Map<number, number>();

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(
        new URL('../workers/vanity-worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e) => {
        const { type, payload } = e.data;
        if (type === 'progress') {
          rates.set(i, payload.hashrate);
          setTotalAttempts(prev => prev + payload.hashrate);
          let total = 0;
          rates.forEach(r => (total += r));
          setHashrate(total);
        } else if (type === 'found') {
          setResults(prev => [payload, ...prev]);
        }
      };

      worker.postMessage({ type: 'start', payload: config });
      workers.push(worker);
    }

    workersRef.current = workers;
  }, [stop, workerCount]);

  const injectEntropy = useCallback((data: ArrayBuffer) => {
    workersRef.current.forEach(w => {
      w.postMessage({ type: 'entropy', payload: data });
    });
  }, []);

  const clearResults = useCallback(() => setResults([]), []);

  useEffect(() => {
    return () => {
      workersRef.current.forEach(w => w.terminate());
    };
  }, []);

  return {
    isRunning, hashrate, totalAttempts, results,
    start, stop, injectEntropy, clearResults, workerCount,
  };
}
