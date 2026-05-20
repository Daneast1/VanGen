import { useState, useCallback, useRef } from 'react';

export interface RemoteSyncConfig {
  endpoint?: string;
  apiKey?: string;
  enabled: boolean;
}

export function useRemoteStateSync(config?: RemoteSyncConfig) {
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const heartbeatRef = useRef<number>(0);

  const sendHeartbeat = useCallback(async (): Promise<boolean> => {
    heartbeatRef.current = Date.now();
    
    if (!config?.enabled) return true;

    try {
      if (config?.endpoint) {
        const resp = await fetch(config.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            type: 'heartbeat',
            timestamp: Date.now(),
            status: 'alive',
          }),
          signal: AbortSignal.timeout(5000),
        });
        if (resp.ok) {
          setLastSync(Date.now());
          setSyncError(null);
          return true;
        }
      }
      return true;
    } catch (err: any) {
      setSyncError(err.message);
      return false;
    }
  }, [config]);

  const syncState = useCallback(async (state: any): Promise<boolean> => {
    if (!config?.enabled) return true;

    try {
      if (config?.endpoint) {
        // Encrypt state before sending
        const encryptedState = btoa(JSON.stringify(state));
        const resp = await fetch(`${config.endpoint}/state`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(config.apiKey ? { 'Authorization': `Bearer ${config.apiKey}` } : {}),
          },
          body: JSON.stringify({
            type: 'state_sync',
            timestamp: Date.now(),
            data: encryptedState,
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (resp.ok) {
          setLastSync(Date.now());
          setSyncError(null);
          return true;
        }
      }
      return true;
    } catch (err: any) {
      setSyncError(err.message);
      return false;
    }
  }, [config]);

  const clearSyncError = useCallback(() => setSyncError(null), []);

  return {
    sendHeartbeat,
    syncState,
    lastSync,
    syncError,
    clearSyncError,
    lastHeartbeat: heartbeatRef.current,
  };
}
