// app/(app)/enseignant/index.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/stores/authStore';
import { syncService } from '../../../src/services/sync/syncService';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Carte from '../../../src/components/ui/Carte';
import StatCard from '../../../src/components/ui/StatCard';

type JourSemaine = 1|2|3|4|5;
const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const COULEURS_MATIERES: Record<string, string> = {
  'Mathématiques': '#1A5276', 'Physique-Chimie': '#7D3C98', 'SVT': '#1E8449',
  'Français': '#B7950B', 'Histoire-Géographie': '#935116', 'default': Colors.primary,
};

export default function TableauBordEnseignant() {
  const session   = useAuthStore(s => s.session);
  const router    = useRouter();
  const [stats,    setStats]    = useState({ nb_classes: 0, nb_evaluations: 0, notes_en_attente: 0 });
  const [edt,      setEdt]      = useState<any[]>([]);
  const [classes,  setClasses]  = useState<any[]>([]);
  const [refresh,  setRefresh]  = useState(false);
  const [jourActif, setJourActif] = useState<JourSemaine>((new Date().getDay() || 1) as JourSemaine);

  useEffect(() => { charger(); }, []);

  async function charger() {
    const db = getDB();
    const [edtRows, classesRows, notesRows] = await Promise.all([
      db.getAllAsync('SELECT * FROM edt ORDER BY jour_semaine, heure_debut'),
      db.getAllAsync('SELECT DISTINCT classe_id, classe FROM edt WHERE classe IS NOT NULL'),
      db.getAllAsync("SELECT COUNT(*) as count FROM notes WHERE synced=0"),
    ]);
    setEdt(edtRows as any[]);
    setClasses(classesRows as any[]);
    setStats({ nb_classes: (classesRows as any[]).length, nb_evaluations: 0, notes_en_attente: (notesRows as any[])[0]?.count || 0 });
  }

  async function handleRefresh() {
    setRefresh(true);
    await syncService.syncComplete();
    await charger();
    setRefresh(false);
  }

  const coursJour = edt.filter(c => c.jour_semaine === jourActif);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={handleRefresh} colors={[Colors.primary]} tintColor={Colors.primary} />}
        showsVerticalScrollIndicator={false}
      >
        {/* En-tête */}
        <View style={[styles.header, { paddingTop: Spacing.md }]}>
          <View>
            <Text style={styles.bonjour}>Bonjour,</Text>
            <Text style={styles.nom}>{session?.nom_complet}</Text>
            <Text style={styles.etab}>{session?.etablissement_nom}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/(app)/commun/profil')} style={styles.avatarBtn}>
            <View style={styles.avatar}>
              <Text style={styles.avatarLettre}>{session?.nom_complet?.[0] || 'E'}</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard titre="Classes" valeur={stats.nb_classes} icone="school-outline" couleur={Colors.primary} />
          <StatCard titre="À synchroniser" valeur={stats.notes_en_attente} icone="cloud-upload-outline" couleur={stats.notes_en_attente > 0 ? Colors.warning : Colors.success} onPress={stats.notes_en_attente > 0 ? handleRefresh : undefined} />
        </View>

        {/* Actions rapides */}
        <Text style={styles.sectionTitre}>Actions rapides</Text>
        <View style={styles.actionsGrid}>
          {[
            { icon: 'checkmark-circle-outline', label: 'Faire l\'appel', couleur: Colors.accent, route: '/(app)/enseignant/appel' },
            { icon: 'create-outline',           label: 'Saisir notes',   couleur: Colors.blue,   route: '/(app)/enseignant/notes-saisie' },
            { icon: 'bar-chart-outline',        label: 'Moyennes',       couleur: Colors.primary, route: '/(app)/enseignant/moyennes' },
            { icon: 'document-text-outline',    label: 'Bulletins',      couleur: Colors.success, route: '/(app)/enseignant/bulletins' },
          ].map(a => (
            <TouchableOpacity key={a.label} style={[styles.action, { borderColor: a.couleur + '30', backgroundColor: a.couleur + '0C' }]}
              onPress={() => router.push(a.route as any)} activeOpacity={0.8}>
              <View style={[styles.actionIcon, { backgroundColor: a.couleur + '18' }]}>
                <Ionicons name={a.icon as any} size={24} color={a.couleur} />
              </View>
              <Text style={[styles.actionLabel, { color: a.couleur }]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* EDT du jour */}
        <Text style={styles.sectionTitre}>Emploi du temps</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.joursScroll}>
          {([1,2,3,4,5] as JourSemaine[]).map(j => (
            <TouchableOpacity key={j} onPress={() => setJourActif(j)}
              style={[styles.jourBtn, j === jourActif && styles.jourBtnActif]}>
              <Text style={[styles.jourLabel, j === jourActif && styles.jourLabelActif]}>{JOURS[j].slice(0,3)}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {coursJour.length === 0
          ? <Carte><Text style={styles.aucun}>Aucun cours ce {JOURS[jourActif]}</Text></Carte>
          : coursJour.map((c, i) => (
            <TouchableOpacity key={i} activeOpacity={0.85} onPress={() => router.push({ pathname: '/(app)/enseignant/appel', params: { cours_id: c.id, classe: c.classe } })}>
              <Carte style={{ ...styles.coursCard, borderLeftColor: COULEURS_MATIERES[c.matiere] || COULEURS_MATIERES.default }} padding={12}>
                <View style={styles.coursLigne}>
                  <View style={[styles.coursHeure, { backgroundColor: (COULEURS_MATIERES[c.matiere] || COULEURS_MATIERES.default) + '15' }]}>
                    <Text style={[styles.coursHeureTxt, { color: COULEURS_MATIERES[c.matiere] || COULEURS_MATIERES.default }]}>{c.heure_debut?.slice(0,5)}</Text>
                    <Text style={[styles.coursHeureFin, { color: COULEURS_MATIERES[c.matiere] || COULEURS_MATIERES.default }]}>{c.heure_fin?.slice(0,5)}</Text>
                  </View>
                  <View style={styles.coursInfo}>
                    <Text style={styles.coursMatiere}>{c.matiere}</Text>
                    <Text style={styles.coursClasse}>{c.classe}{c.salle ? ' · ' + c.salle : ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.gray400} />
                </View>
              </Carte>
            </TouchableOpacity>
          ))
        }
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: Spacing.md, paddingBottom: 100 },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.lg },
  bonjour: { fontSize: Typography.sm,  color: Colors.gray500 },
  nom:     { fontSize: Typography.xl,  fontWeight: Typography.bold,    color: Colors.gray900, marginTop: 2 },
  etab:    { fontSize: Typography.xs,  color: Colors.gray400,          marginTop: 2 },
  avatarBtn: {},
  avatar:  { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarLettre: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.white },
  statsRow:     { flexDirection: 'row', marginBottom: Spacing.lg },
  sectionTitre: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.gray900, marginBottom: Spacing.sm, marginTop: 4 },
  actionsGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: Spacing.lg },
  action: { width: '47%', borderRadius: Radius.md, borderWidth: 1.5, padding: Spacing.md, alignItems: 'center', gap: 8 },
  actionIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: Typography.sm, fontWeight: Typography.semibold, textAlign: 'center' },
  joursScroll:  { marginBottom: Spacing.sm },
  jourBtn:      { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, marginRight: 8, backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.gray200 },
  jourBtnActif: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  jourLabel:    { fontSize: Typography.sm, color: Colors.gray500, fontWeight: Typography.medium },
  jourLabelActif: { color: Colors.white },
  coursCard: { borderLeftWidth: 4, marginBottom: 8 },
  coursLigne: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coursHeure: { borderRadius: Radius.sm, padding: 8, alignItems: 'center', minWidth: 52 },
  coursHeureTxt: { fontSize: Typography.sm, fontWeight: Typography.bold },
  coursHeureFin: { fontSize: Typography.xs },
  coursInfo: { flex: 1 },
  coursMatiere: { fontSize: Typography.base, fontWeight: Typography.semibold, color: Colors.gray900 },
  coursClasse:  { fontSize: Typography.xs,   color: Colors.gray500, marginTop: 2 },
  aucun: { textAlign: 'center', color: Colors.gray400, fontSize: Typography.sm, padding: Spacing.sm },
});
