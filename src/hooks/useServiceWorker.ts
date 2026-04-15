import { useEffect, useRef } from 'react';

/**
 * Registers the Service Worker for offline / air-gap capability and
 * sends periodic keep-alive pings while generation is running to prevent
 * the browser from throttling background tabs.
 */
export function useServiceWorker(isRunning: boolean) {
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);

  // Register the Service Worker once on mount
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/service-worker.js', { scope: '/' })
      .then(registration => {
        swRegistrationRef.current = registration;
        console.log('[VanityGen] Service Worker registered — offline mode active');
      })
      .catch(err => {
        console.warn('[VanityGen] Service Worker registration failed:', err);
      });

    return () => {
      // Don't unregister on unmount — SW should persist
    };
  }, []);

  // Send keep-alive pings while generation is running
  // This prevents Chrome/Safari from freezing background Web Workers
  useEffect(() => {
    if (isRunning) {
      keepAliveRef.current = setInterval(() => {
        if (!navigator.serviceWorker?.controller) return;

        const channel = new MessageChannel();
        channel.port1.onmessage = (e) => {
          if (e.data?.type === 'ALIVE') {
            // SW is alive — Workers continue unthrottled
          }
        };

        navigator.serviceWorker.controller.postMessage(
          { type: 'KEEP_ALIVE' },
          [channel.port2]
        );
      }, 10_000); // Every 10 seconds
    } else {
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
    }

    return () => {
      if (keepAliveRef.current) {
        clearInterval(keepAliveRef.current);
        keepAliveRef.current = null;
      }
    };
  }, [isRunning]);
}
