// app/(app)/_layout.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Stack }     from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';

export default function AppLayout() {
  const router      = useRouter();
  const estConnecte = useAuthStore(s => s.estConnecte);

  useEffect(() => {
    if (!estConnecte) router.replace('/auth/connexion');
  }, [estConnecte]);

  if (!estConnecte) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="enseignant" />
      <Stack.Screen name="parent"     />
      <Stack.Screen name="directeur"  />
    </Stack>
  );
}
