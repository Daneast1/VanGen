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
  targetAddress?: string;
}

export function useVanityGenerator() {
  const [isRunning, setIsRunning] = useState(false);
  const [hashrate, setHashrate] = useState(0);
  const [totalAttempts, setTotalAttempts] = useState(0);
  const [results, setResults] = useState<FoundAddress[]>([]);

  const workersRef = useRef<Worker[]>([]);
  // Per-worker hashrate map: workerIndex → last reported rate (addr/s)
  const workerRatesRef = useRef<Map<number, number>>(new Map());
  // Per-worker attempt counts for accurate total
  const workerAttemptsRef = useRef<Map<number, number>>(new Map());

  // Use ALL logical cores — workers run in separate threads and don't block the UI
  const workerCount = Math.max(1, navigator.hardwareConcurrency || 4);

  const stop = useCallback(() => {
    workersRef.current.forEach(w => {
      w.postMessage({ type: 'stop' });
      // Slight delay before terminate so the worker can clean up gracefully
      setTimeout(() => w.terminate(), 100);
    });
    workersRef.current = [];
    workerRatesRef.current.clear();
    workerAttemptsRef.current.clear();
    setIsRunning(false);
    setHashrate(0);
  }, []);

  const start = useCallback((config: GeneratorConfig) => {
    stop();
    setIsRunning(true);
    setTotalAttempts(0);
    setHashrate(0);
    workerRatesRef.current.clear();
    workerAttemptsRef.current.clear();

    const workers: Worker[] = [];

    for (let i = 0; i < workerCount; i++) {
      const workerIndex = i;

      const worker = new Worker(
        new URL('../workers/vanity-worker.ts', import.meta.url),
        { type: 'module' }
      );

      worker.onmessage = (e) => {
        const { type, payload } = e.data;

        if (type === 'progress') {
          // FIX: payload.hashrate is addresses/second from THIS worker
          // Store it per-worker and sum all workers for total hashrate
          workerRatesRef.current.set(workerIndex, payload.hashrate as number);

          let totalRate = 0;
          workerRatesRef.current.forEach(rate => { totalRate += rate; });
          setHashrate(totalRate);

          // Track total cumulative attempts properly
          const prevAttempts = workerAttemptsRef.current.get(workerIndex) || 0;
          const newAttempts = prevAttempts + payload.hashrate;
          workerAttemptsRef.current.set(workerIndex, newAttempts);
          setTotalAttempts(prev => prev + payload.hashrate);

        } else if (type === 'found') {
          setResults(prev => [payload as FoundAddress, ...prev]);
        }
      };

      worker.onerror = (err) => {
        console.error(`[VanityGen] Worker ${workerIndex} error:`, err);
      };

      worker.postMessage({ type: 'start', payload: config });
      workers.push(worker);
    }

    workersRef.current = workers;
  }, [stop, workerCount]);

  // Inject entropy into all running workers
  const injectEntropy = useCallback((data: ArrayBuffer) => {
    workersRef.current.forEach(w => {
      // Transfer a copy so each worker gets the full entropy buffer
      const copy = data.slice(0);
      w.postMessage({ type: 'entropy', payload: copy }, [copy]);
    });
  }, []);

  const clearResults = useCallback(() => setResults([]), []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workersRef.current.forEach(w => w.terminate());
    };
  }, []);

  return {
    isRunning,
    hashrate,
    totalAttempts,
    results,
    start,
    stop,
    injectEntropy,
    clearResults,
    workerCount,
  };
}
