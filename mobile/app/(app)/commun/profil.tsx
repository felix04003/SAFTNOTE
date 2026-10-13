// app/(app)/commun/profil.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/stores/authStore';
import { authApi } from '../../../src/services/api/client';
import { syncService } from '../../../src/services/sync/syncService';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import Carte from '../../../src/components/ui/Carte';

export default function ProfilScreen() {
  const session     = useAuthStore(s => s.session);
  const deconnexion = useAuthStore(s => s.deconnexion);
  const changerEtablissement = useAuthStore(s => s.changerEtablissement);
  const router      = useRouter();
  const [autresEcoles, setAutresEcoles] = useState<{ code: string; nom: string }[]>([]);

  // Parent présent dans plusieurs écoles : proposer de basculer (3.4). Hors ligne : rien à afficher.
  useEffect(() => {
    if (session?.role !== 'parent') return;
    authApi.mesEtablissements()
      .then((res: any) => setAutresEcoles((Array.isArray(res) ? res : []).filter((e: any) => !e.courant)))
      .catch(() => setAutresEcoles([]));
  }, [session?.etablissement_id]);

  function handleChangerEcole(ecole: { code: string; nom: string }) {
    Alert.alert('Changer d\'établissement', `Ouvrir ${ecole.nom} ? Les données de l'école actuelle seront retirées de ce téléphone puis rechargées pour la nouvelle.`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Ouvrir', onPress: async () => {
        try {
          await changerEtablissement(ecole.code);
          try { await syncService.syncComplete(); } catch { /* resynchronisé plus tard */ }
          router.replace('/(app)');
        } catch (err: any) {
          Alert.alert('Changement impossible', err?.message || 'Vérifiez votre connexion et réessayez.');
        }
      }},
    ]);
  }

  async function handleDeconnexion() {
    Alert.alert('Déconnexion', 'Voulez-vous vraiment vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: async () => {
        await deconnexion();
        router.replace('/auth/connexion');
      }},
    ]);
  }

  async function handleSync() {
    try {
      await syncService.syncComplete();
      Alert.alert('Synchronisation', 'Données mises à jour avec succès.');
    } catch {
      Alert.alert('Synchronisation impossible', 'Vérifiez votre connexion et réessayez.');
    }
  }

  const ROLE_LABELS: Record<string, string> = {
    enseignant: 'Enseignant(e)', parent: 'Parent', directeur: 'Directeur / Directrice',
    censeur: 'Censeur / Censeure', admin: 'Administrateur(trice)',
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre="Mon profil" retour />
      <View style={styles.content}>
        <View style={[styles.avatarSection, Shadow.md]}>
          <View style={styles.avatar}>
            <Text style={styles.avatarLettre}>{session?.nom_complet?.[0] || '?'}</Text>
          </View>
          <Text style={styles.nom}>{session?.nom_complet}</Text>
          <Text style={styles.role}>{ROLE_LABELS[session?.role || ''] || session?.role}</Text>
          <Text style={styles.etab}>{session?.etablissement_nom}</Text>
        </View>

        <Carte>
          {[
            { icon: 'sync-outline', label: 'Synchroniser maintenant', onPress: handleSync, couleur: Colors.primary },
            { icon: 'information-circle-outline', label: 'Version 1.0.0', couleur: Colors.gray400 },
          ].map((item, i) => (
            <TouchableOpacity key={i} style={[styles.menuItem, i > 0 && styles.menuSep]} onPress={item.onPress} hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}>
              <Ionicons name={item.icon as any} size={20} color={item.couleur} />
              <Text style={[styles.menuLabel, { color: item.couleur }]}>{item.label}</Text>
              {item.onPress && <Ionicons name="chevron-forward" size={16} color={Colors.gray300} />}
            </TouchableOpacity>
          ))}
        </Carte>

        {autresEcoles.length > 0 && (
          <Carte>
            {autresEcoles.map((e, i) => (
              <TouchableOpacity key={e.code} style={[styles.menuItem, i > 0 && styles.menuSep]} onPress={() => handleChangerEcole(e)}>
                <Ionicons name="swap-horizontal-outline" size={20} color={Colors.primary} />
                <Text style={[styles.menuLabel, { color: Colors.primary }]}>Passer à {e.nom}</Text>
                <Ionicons name="chevron-forward" size={16} color={Colors.gray300} />
              </TouchableOpacity>
            ))}
          </Carte>
        )}

        <TouchableOpacity style={[styles.btnDeconnexion, Shadow.sm]} onPress={handleDeconnexion} activeOpacity={0.85}>
          <Ionicons name="log-out-outline" size={20} color={Colors.danger} />
          <Text style={styles.btnDeconnexionLabel}>Se déconnecter</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.md },
  avatarSection: { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.xl, alignItems: 'center', marginBottom: Spacing.md },
  avatar:  { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.md },
  avatarLettre: { fontSize: Typography.xxl, fontWeight: Typography.bold, color: Colors.white },
  nom:     { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.gray900 },
  role:    { fontSize: Typography.sm, color: Colors.primary, fontWeight: Typography.medium, marginTop: 4 },
  etab:    { fontSize: Typography.xs, color: Colors.gray400, marginTop: 2 },
  menuItem:  { flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.sm, gap: 12 },
  menuSep:   { borderTopWidth: 1, borderTopColor: Colors.gray100 },
  menuLabel: { flex: 1, fontSize: Typography.base },
  btnDeconnexion: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: Colors.white, borderRadius: Radius.md, height: 52, marginTop: Spacing.md, borderWidth: 1.5, borderColor: Colors.dangerLight },
  btnDeconnexionLabel: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.danger },
});
