// app/index.tsx
import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../src/stores/authStore';
import { View, ActivityIndicator } from 'react-native';
import { COULEURS } from '../src/constants/theme';

export default function Index() {
  const router        = useRouter();
  const estConnecte   = useAuthStore(s => s.estConnecte);
  const estParent     = useAuthStore(s => s.estParent);
  const estEnseignant = useAuthStore(s => s.estEnseignant);

  useEffect(() => {
    if (!estConnecte) {
      router.replace('/auth/connexion');
    } else if (estParent()) {
      router.replace('/(app)/parent');
    } else {
      router.replace('/(app)/enseignant');
    }
  }, [estConnecte]);

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: COULEURS.fond }}>
      <ActivityIndicator color={COULEURS.vert} size="large" />
    </View>
  );
}
