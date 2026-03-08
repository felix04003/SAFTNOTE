// app/_layout.tsx
import React, { useEffect } from 'react';
import { Stack }         from 'expo-router';
import { StatusBar }     from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Toast             from 'react-native-toast-message';
import { useAuthStore }  from '../src/stores/authStore';
import { ouvrirBD }      from '../src/services/storage/database';
import { syncService }   from '../src/services/sync/syncService';
import { authEventEmitter } from '../src/services/api/client';
import { useRouter }     from 'expo-router';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router         = useRouter();
  const chargerSession = useAuthStore(s => s.chargerSession);
  const deconnexion    = useAuthStore(s => s.deconnexion);

  useEffect(() => {
    async function init() {
      try {
        // 1. Ouvrir la base SQLite locale
        await ouvrirBD();
        // 2. Charger la session persistée
        await chargerSession();
        // 3. Démarrer la sync automatique
        syncService.demarrer();
      } finally {
        SplashScreen.hideAsync();
      }
    }
    init();

    // Écouter la déconnexion forcée (token expiré)
    const unsub = authEventEmitter.on('deconnexion', async () => {
      await deconnexion();
      router.replace('/auth/connexion');
    });

    return () => {
      syncService.arreter();
      unsub();
    };
  }, []);

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="auth"          options={{ animation: 'none' }} />
        <Stack.Screen name="(app)"         options={{ animation: 'none' }} />
        <Stack.Screen name="+not-found"    />
      </Stack>
      <Toast />
    </>
  );
}
