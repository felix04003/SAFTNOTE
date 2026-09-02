// app/(app)/directeur/index.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/stores/authStore';
import { directeurApi, ApiError } from '../../../src/services/api/client';
import { Colors, Typography, Spacing, Radius } from '../../../src/utils/theme';
import Carte from '../../../src/components/ui/Carte';
import StatCard from '../../../src/components/ui/StatCard';

interface DashboardStats {
  annee_courante:       string | null;
  nb_eleves_actifs:     number;
  nb_classes:           number;
  nb_enseignants:       number;
  absences_aujourd_hui: number;
  incidents_ouverts:    number;
  moyenne_generale:     string | null;
}

const STATS_VIDES: DashboardStats = {
  annee_courante: null,
  nb_eleves_actifs: 0,
  nb_classes: 0,
  nb_enseignants: 0,
  absences_aujourd_hui: 0,
  incidents_ouverts: 0,
  moyenne_generale: null,
};

export default function DirecteurDashboard() {
  const session             = useAuthStore(s => s.session);
  const router              = useRouter();
  const [stats,      setStats]      = useState<DashboardStats>(STATS_VIDES);
  const [chargement, setChargement] = useState(true);
  const [refresh,    setRefresh]    = useState(false);
  const [erreur,     setErreur]     = useState<string | null>(null);

  const charger = useCallback(async () => {
    setErreur(null);
    try {
      const data = await directeurApi.getDashboard();
      setStats({ ...STATS_VIDES, ...data });
    } catch (e) {
      if (e instanceof ApiError && e.estHorsLigne) {
        setErreur('Hors ligne — données indisponibles sans connexion');
      } else {
        setErreur('Impossible de charger le tableau de bord');
      }
    } finally {
      setChargement(false);
      setRefresh(false);
    }
  }, []);

  useEffect(() => { charger(); }, [charger]);

  function handleRefresh() {
    setRefresh(true);
    charger();
  }

  const ACTIONS = [
    { icon: 'people-outline',    label: 'Élèves',     couleur: Colors.primary, route: '/(app)/enseignant/classes'     },
    { icon: 'bar-chart-outline', label: 'Notes',      couleur: Colors.blue,    route: '/(app)/enseignant/moyennes'    },
    { icon: 'warning-outline',   label: 'Discipline', couleur: Colors.warning, route: '/(app)/enseignant/evaluations' },
    { icon: 'person-outline',    label: 'Profil',     couleur: Colors.gray500, route: '/(app)/commun/profil'          },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            onRefresh={handleRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* En-tête */}
        <View style={[styles.header, { paddingTop: Spacing.md }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.bonjour}>Tableau de bord</Text>
            <Text style={styles.nom}>{session?.nom_complet}</Text>
            <Text style={styles.etab}>{session?.etablissement_nom}</Text>
            {stats.annee_courante && (
              <View style={styles.anneeBadge}>
                <Text style={styles.anneeTexte}>{stats.annee_courante}</Text>
              </View>
            )}
          </View>
          <TouchableOpacity onPress={() => router.push('/(app)/commun/profil')} style={styles.avatarBtn}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLettre}>{session?.nom_complet?.[0] || 'D'}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Chargement initial */}
        {chargement && (
          <View style={styles.loaderWrap}>
            <ActivityIndicator size="large" color={Colors.primary} />
          </View>
        )}

        {/* Erreur */}
        {!chargement && erreur && (
          <Carte style={styles.erreurCarte} padding={Spacing.md}>
            <Ionicons name="cloud-offline-outline" size={24} color={Colors.danger} />
            <Text style={styles.erreurTexte}>{erreur}</Text>
            <TouchableOpacity onPress={handleRefresh} style={styles.reessayer}>
              <Text style={styles.reessayerTexte}>Réessayer</Text>
            </TouchableOpacity>
          </Carte>
        )}

        {!chargement && !erreur && (
          <>
            {/* Stats ligne 1 */}
            <View style={styles.statsRow}>
              <StatCard titre="Élèves" valeur={stats.nb_eleves_actifs} icone="people-outline"  couleur={Colors.primary} index={0} />
              <StatCard titre="Classes" valeur={stats.nb_classes}      icone="school-outline"  couleur={Colors.blue}    index={1} />
            </View>
            {/* Stats ligne 2 */}
            <View style={styles.statsRow}>
              <StatCard
                titre="Enseignants"
                valeur={stats.nb_enseignants}
                icone="person-outline"
                couleur={Colors.success}
                index={2}
              />
              <StatCard
                titre="Absences auj."
                valeur={stats.absences_aujourd_hui}
                icone="close-circle-outline"
                couleur={stats.absences_aujourd_hui > 0 ? Colors.danger : Colors.success}
                index={3}
              />
            </View>

            {/* Incidents + Moyenne */}
            <View style={styles.indicateurs}>
              <Carte style={styles.indicateurCarte} padding={Spacing.md}>
                <View style={styles.indicateurLigne}>
                  <View style={[styles.indicateurIcone, { backgroundColor: Colors.warning + '18' }]}>
                    <Ionicons name="warning-outline" size={20} color={Colors.warning} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.indicateurLabel}>Incidents ouverts</Text>
                    <Text style={[styles.indicateurValeur, { color: stats.incidents_ouverts > 0 ? Colors.warning : Colors.success }]}>
                      {stats.incidents_ouverts}
                    </Text>
                  </View>
                </View>
              </Carte>

              <Carte style={styles.indicateurCarte} padding={Spacing.md}>
                <View style={styles.indicateurLigne}>
                  <View style={[styles.indicateurIcone, { backgroundColor: Colors.primary + '18' }]}>
                    <Ionicons name="bar-chart-outline" size={20} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.indicateurLabel}>Moyenne générale</Text>
                    <Text style={[styles.indicateurValeur, { color: Colors.primary }]}>
                      {stats.moyenne_generale ? `${stats.moyenne_generale}/20` : '—'}
                    </Text>
                  </View>
                </View>
              </Carte>
            </View>

            {/* Actions rapides */}
            <Text style={styles.sectionTitre}>Accès rapide</Text>
            <View style={styles.actionsGrid}>
              {ACTIONS.map(a => (
                <TouchableOpacity
                  key={a.label}
                  style={[styles.action, { borderColor: a.couleur + '30', backgroundColor: a.couleur + '0C' }]}
                  onPress={() => router.push(a.route as any)}
                  activeOpacity={0.8}
                >
                  <View style={[styles.actionIcone, { backgroundColor: a.couleur + '18' }]}>
                    <Ionicons name={a.icon as any} size={24} color={a.couleur} />
                  </View>
                  <Text style={[styles.actionLabel, { color: a.couleur }]}>{a.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: Spacing.md, paddingBottom: 100 },

  header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.lg },
  bonjour:      { fontSize: Typography.sm, color: Colors.gray500 },
  nom:          { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.gray900, marginTop: 2 },
  etab:         { fontSize: Typography.xs, color: Colors.gray400, marginTop: 2 },
  anneeBadge:   { marginTop: 6, alignSelf: 'flex-start', backgroundColor: Colors.primary + '15', borderRadius: Radius.full, paddingHorizontal: 10, paddingVertical: 3 },
  anneeTexte:   { fontSize: Typography.xs, color: Colors.primary, fontWeight: Typography.semibold },
  avatarBtn:    {},
  avatar:       { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.success, alignItems: 'center', justifyContent: 'center' },
  avatarLettre: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.white },

  loaderWrap: { alignItems: 'center', marginTop: 60 },

  erreurCarte:    { alignItems: 'center', gap: 10, marginBottom: Spacing.lg },
  erreurTexte:    { fontSize: Typography.sm, color: Colors.danger, textAlign: 'center' },
  reessayer:      { paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: Radius.md },
  reessayerTexte: { color: Colors.white, fontSize: Typography.sm, fontWeight: Typography.semibold },

  statsRow:    { flexDirection: 'row', marginBottom: Spacing.sm },
  indicateurs: { flexDirection: 'row', gap: 10, marginBottom: Spacing.lg, marginTop: Spacing.sm },
  indicateurCarte:  { flex: 1 },
  indicateurLigne:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  indicateurIcone:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  indicateurLabel:  { fontSize: Typography.xs, color: Colors.gray500, marginBottom: 2 },
  indicateurValeur: { fontSize: Typography.lg, fontWeight: Typography.bold },

  sectionTitre: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.gray900, marginBottom: Spacing.sm },
  actionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: Spacing.lg },
  action:       { width: '47%', borderRadius: Radius.md, borderWidth: 1.5, padding: Spacing.md, alignItems: 'center', gap: 8 },
  actionIcone:  { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel:  { fontSize: Typography.sm, fontWeight: Typography.semibold, textAlign: 'center' },
});
