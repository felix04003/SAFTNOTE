// app/(app)/_layout.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { Stack }     from 'expo-router';
import { useAuthStore } from '../../src/stores/authStore';

export default function AppLayout() {
  const router      = useRouter();
  const estConnecte = useAuthStore(s => s.estConnecte);
  const doitChangerMdp = useAuthStore(s => !!s.session?.doit_changer_mdp);

  useEffect(() => {
    if (!estConnecte) router.replace('/auth/connexion');
    else if (doitChangerMdp) router.replace('/auth/changer-mot-de-passe');
  }, [estConnecte, doitChangerMdp]);

  if (!estConnecte || doitChangerMdp) return null;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="enseignant" />
      <Stack.Screen name="parent"     />
      <Stack.Screen name="directeur"  />
    </Stack>
  );
}
