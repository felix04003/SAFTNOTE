// src/hooks/useSync.ts
import { useState, useEffect, useCallback } from 'react';
import * as Network from 'expo-network';
import { syncService } from '../services/sync/syncService';

export function useSync() {
  const [connecte, setConnecte] = useState(true);
  const [enSync,   setEnSync]   = useState(false);
  const [dernSync, setDernSync] = useState<Date | null>(null);

  useEffect(() => {
    // Vérification réseau au montage
    Network.getNetworkStateAsync().then(s => setConnecte(!!(s.isConnected && s.isInternetReachable)));

    // Surveiller les changements de réseau
    const interval = setInterval(async () => {
      const s = await Network.getNetworkStateAsync();
      const estConnecte = !!(s.isConnected && s.isInternetReachable);
      setConnecte(estConnecte);
    }, 15_000);

    return () => clearInterval(interval);
  }, []);

  const syncMaintenant = useCallback(async () => {
    setEnSync(true);
    try {
      await syncService.syncComplete();
      setDernSync(new Date());
    } finally {
      setEnSync(false);
    }
  }, []);

  return { connecte, enSync, dernSync, syncMaintenant };
}
