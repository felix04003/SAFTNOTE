// app/(app)/enseignant/classes.tsx
// Liste des classes assignées à l'enseignant avec stats rapides
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { syncService } from '../../../src/services/sync/syncService';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Carte from '../../../src/components/ui/Carte';
import StatCard from '../../../src/components/ui/StatCard';

interface ClasseStats {
  classe_id: string;
  classe: string;
  nb_eleves: number;
  nb_matieres: number;
  nb_absences_jour: number;
  moyenne_classe: number | null;
}

export default function ClassesEnseignantScreen() {
  const router = useRouter();
  const [classes,   setClasses]   = useState<ClasseStats[]>([]);
  const [recherche, setRecherche] = useState('');
  const [refresh,   setRefresh]   = useState(false);
  const [totalEleves, setTotalEleves] = useState(0);

  useEffect(() => { charger(); }, []);

  async function charger() {
    const db = getDB();

    // Récupérer les classes depuis l'EDT local
    const rows: any[] = await db.getAllAsync(`
      SELECT
        classe_id,
        classe,
        COUNT(DISTINCT matiere) AS nb_matieres
      FROM edt
      WHERE classe IS NOT NULL AND classe_id IS NOT NULL
      GROUP BY classe_id, classe
      ORDER BY classe
    `);

    // Pour chaque classe, récupérer stats complémentaires
    const stats: ClasseStats[] = await Promise.all(rows.map(async (r) => {
      const [elevesRow, absRow, moyRow] = await Promise.all([
        db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM eleves WHERE classe_id=?`, [r.classe_id]
        ),
        db.getFirstAsync<{ count: number }>(
          `SELECT COUNT(*) as count FROM absences
           WHERE classe_id=? AND date_cours=date('now') AND est_justifie=0`, [r.classe_id]
        ),
        db.getFirstAsync<{ moy: number | null }>(
          `SELECT AVG(moyenne) as moy FROM moyennes WHERE classe_id=?`, [r.classe_id]
        ),
      ]);
      return {
        classe_id:       r.classe_id,
        classe:          r.classe,
        nb_matieres:     r.nb_matieres,
        nb_eleves:       elevesRow?.count ?? 0,
        nb_absences_jour: absRow?.count ?? 0,
        moyenne_classe:  moyRow?.moy ?? null,
      };
    }));

    setClasses(stats);
    setTotalEleves(stats.reduce((sum, c) => sum + c.nb_eleves, 0));
  }

  async function handleRefresh() {
    setRefresh(true);
    try {
      await syncService.syncComplete();
      await charger();
    } finally {
      setRefresh(false);
    }
  }

  const filtrees = recherche.trim()
    ? classes.filter(c => c.classe.toLowerCase().includes(recherche.toLowerCase()))
    : classes;

  function couleurMoyenne(moy: number | null): string {
    if (moy === null) return Colors.gray400;
    if (moy >= 14) return Colors.success;
    if (moy >= 10) return Colors.primary;
    return Colors.danger;
  }

  function renderClasse({ item: c }: { item: ClasseStats }) {
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => router.push({
          pathname: '/(app)/enseignant/appel',
          params: { classe: c.classe, cours_id: c.classe_id },
        })}
      >
        <Carte style={styles.classeCard} padding={0}>
          {/* En-tête couleur */}
          <View style={[styles.classeHeader, { backgroundColor: Colors.primary }]}>
            <View style={styles.classeHeaderLeft}>
              <View style={styles.classeIco}>
                <Ionicons name="people" size={22} color={Colors.white} />
              </View>
              <View>
                <Text style={styles.classeNom}>{c.classe}</Text>
                <Text style={styles.classeSous}>{c.nb_matieres} matière{c.nb_matieres > 1 ? 's' : ''}</Text>
              </View>
            </View>
            {c.moyenne_classe !== null && (
              <View style={styles.moyBulle}>
                <Text style={[styles.moyNum, { color: couleurMoyenne(c.moyenne_classe) }]}>
                  {c.moyenne_classe.toFixed(1)}
                </Text>
                <Text style={styles.moyLabel}>moy.</Text>
              </View>
            )}
          </View>

          {/* Stats */}
          <View style={styles.classeStats}>
            <View style={styles.statItem}>
              <Ionicons name="person-outline" size={15} color={Colors.gray500} />
              <Text style={styles.statTxt}>{c.nb_eleves} élèves</Text>
            </View>
            {c.nb_absences_jour > 0 && (
              <View style={[styles.statItem, styles.statAlerte]}>
                <Ionicons name="warning-outline" size={15} color={Colors.danger} />
                <Text style={[styles.statTxt, { color: Colors.danger }]}>
                  {c.nb_absences_jour} absent{c.nb_absences_jour > 1 ? 's' : ''} auj.
                </Text>
              </View>
            )}
            <TouchableOpacity
              style={styles.appelBtn}
              onPress={() => router.push({
                pathname: '/(app)/enseignant/appel',
                params: { classe: c.classe, cours_id: c.classe_id },
              })}
            >
              <Ionicons name="checkmark-circle-outline" size={14} color={Colors.primary} />
              <Text style={styles.appelBtnLabel}>Faire l'appel</Text>
            </TouchableOpacity>
          </View>
        </Carte>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Résumé global */}
      <View style={styles.resumeBar}>
        <StatCard titre="Classes" valeur={classes.length} icone="school-outline" couleur={Colors.primary} />
        <StatCard titre="Élèves suivis" valeur={totalEleves} icone="people-outline" couleur={Colors.blue} />
      </View>

      {/* Recherche */}
      <View style={styles.rechercheRow}>
        <View style={styles.rechercheContainer}>
          <Ionicons name="search-outline" size={16} color={Colors.gray400} />
          <TextInput
            style={styles.rechercheInput}
            placeholder="Rechercher une classe…"
            placeholderTextColor={Colors.gray400}
            value={recherche}
            onChangeText={setRecherche}
          />
          {recherche.length > 0 && (
            <TouchableOpacity onPress={() => setRecherche('')}>
              <Ionicons name="close-circle" size={16} color={Colors.gray400} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <FlatList
        data={filtrees}
        keyExtractor={c => c.classe_id}
        renderItem={renderClasse}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refresh}
            onRefresh={handleRefresh}
            colors={[Colors.primary]}
            tintColor={Colors.primary}
          />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="school-outline" size={48} color={Colors.gray300} />
            <Text style={styles.emptyTxt}>
              {recherche ? 'Aucune classe trouvée' : 'Aucune classe assignée'}
            </Text>
            <Text style={styles.emptySous}>Synchronisez pour charger vos classes</Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:       { flex: 1, backgroundColor: Colors.background },
  resumeBar:  { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingTop: Spacing.md },
  rechercheRow: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  rechercheContainer: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: 12, height: 42, gap: 8,
    borderWidth: 1, borderColor: Colors.gray200,
  },
  rechercheInput: { flex: 1, fontSize: Typography.sm, color: Colors.gray900 },
  liste:      { paddingHorizontal: Spacing.md, paddingBottom: 40, gap: 10 },
  classeCard: { overflow: 'hidden', ...Shadow.sm },
  classeHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.md, paddingVertical: 14,
  },
  classeHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  classeIco:  {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: Colors.white + '25', alignItems: 'center', justifyContent: 'center',
  },
  classeNom:  { fontSize: Typography.md, fontWeight: Typography.bold, color: Colors.white },
  classeSous: { fontSize: Typography.xs, color: Colors.white + 'AA', marginTop: 2 },
  moyBulle:   {
    backgroundColor: Colors.white, borderRadius: Radius.md,
    paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center',
  },
  moyNum:     { fontSize: Typography.lg, fontWeight: Typography.bold },
  moyLabel:   { fontSize: Typography.xs - 1, color: Colors.gray400 },
  classeStats:{
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap',
    paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 12,
  },
  statItem:   { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statAlerte: { backgroundColor: Colors.dangerLight, paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full },
  statTxt:    { fontSize: Typography.xs, color: Colors.gray600, fontWeight: Typography.medium },
  appelBtn:   {
    marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.primary + '40',
  },
  appelBtnLabel: { fontSize: Typography.xs, color: Colors.primary, fontWeight: Typography.semibold },
  empty:      { alignItems: 'center', paddingTop: 60, gap: 10 },
  emptyTxt:   { fontSize: Typography.base, color: Colors.gray500, fontWeight: Typography.medium },
  emptySous:  { fontSize: Typography.xs, color: Colors.gray400 },
});
