// app/_layout.tsx
import React, { useEffect } from 'react';
import { Stack, useRouter, useRootNavigationState } from 'expo-router';
import { StatusBar }     from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import Toast             from 'react-native-toast-message';
import { useAuthStore }  from '../src/stores/authStore';
import { ouvrirBD }      from '../src/services/storage/database';
import { syncService }   from '../src/services/sync/syncService';
import { authEventEmitter } from '../src/services/api/client';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const router          = useRouter();
  const navigationState = useRootNavigationState();
  const chargerSession  = useAuthStore(s => s.chargerSession);
  const deconnexion     = useAuthStore(s => s.deconnexion);
  const chargement      = useAuthStore(s => s.chargement);
  const estConnecte     = useAuthStore(s => s.estConnecte);
  const estParent       = useAuthStore(s => s.estParent);
  const estDirecteur    = useAuthStore(s => s.estDirecteur);

  // Init au démarrage
  useEffect(() => {
    async function init() {
      try {
        await ouvrirBD();
        await chargerSession();
        syncService.demarrer();
      } finally {
        SplashScreen.hideAsync();
      }
    }
    init();

    // Un seul traitement à la fois : deconnexion() appelle l'API, dont un 401
    // ré-émettrait cet événement
    let deconnexionEnCours = false;
    const unsub = authEventEmitter.on('deconnexion', async (info?: { message?: string }) => {
      if (deconnexionEnCours) return;
      deconnexionEnCours = true;
      try {
        await deconnexion();
        // Après la déconnexion : elle ne touche pas à ce message
        useAuthStore.getState().definirMessageConnexion(info?.message ?? null);
        router.replace('/auth/connexion');
      } finally {
        deconnexionEnCours = false;
      }
    });

    return () => {
      syncService.arreter();
      unsub();
    };
  }, []);

  // Redirection auth — uniquement quand le navigator est prêt ET la session chargée
  useEffect(() => {
    if (!navigationState?.key || chargement) return;
    if (!estConnecte) {
      router.replace('/auth/connexion');
    } else if (estParent()) {
      router.replace('/(app)/parent');
    } else if (estDirecteur()) {
      router.replace('/(app)/directeur');
    } else {
      router.replace('/(app)/enseignant');
    }
  }, [navigationState?.key, chargement, estConnecte]);

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
