// app/(app)/enseignant/index.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, FlatList } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/stores/authStore';
import { useEdtStore } from '../../../src/stores/edtStore';
import { syncService } from '../../../src/services/sync/syncService';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow, couleurMatiere } from '../../../src/utils/theme';
import Carte from '../../../src/components/ui/Carte';
import StatCard from '../../../src/components/ui/StatCard';
import SyncStatus, { StatutSync } from '../../../src/components/ui/SyncStatus';
import EmptyState from '../../../src/components/ui/EmptyState';

type JourSemaine = 1|2|3|4|5;
const JOURS = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];

export default function TableauBordEnseignant() {
  const session   = useAuthStore(s => s.session);
  const router    = useRouter();
  const [stats,    setStats]    = useState({ nb_classes: 0, nb_evaluations: 0, notes_en_attente: 0 });
  const [refresh,  setRefresh]  = useState(false);
  const { edt, chargerEdt }    = useEdtStore();
  const [jourActif, setJourActif] = useState<JourSemaine>((new Date().getDay() || 1) as JourSemaine);
  const [statutSync, setStatutSync] = useState<StatutSync>('ok');
  const [absJour, setAbsJour] = useState<number[]>([0,0,0,0,0,0,0]);

  useEffect(() => { charger(); }, []);

  async function charger() {
    const db = getDB();
    const [notesRows, absRows] = await Promise.all([
      db.getAllAsync("SELECT COUNT(*) as count FROM notes WHERE synced=0"),
      db.getAllAsync(
        "SELECT date_cours, COUNT(*) as nb FROM presences WHERE statut='absent' AND date_cours >= date('now','-6 days') GROUP BY date_cours ORDER BY date_cours"
      ),
      chargerEdt(),
    ]);
    const nbEnAttente = (notesRows as any[])[0]?.count || 0;
    const edtFrais    = useEdtStore.getState().edt;
    const nbClasses   = new Set(edtFrais.map((c: any) => c.classe_id).filter(Boolean)).size;
    setStats({ nb_classes: nbClasses, nb_evaluations: 0, notes_en_attente: nbEnAttente });
    setStatutSync(nbEnAttente > 0 ? 'en_attente' : 'ok');
    // Sparkline : 7 jours glissants (index 0 = il y a 6 jours, 6 = aujourd'hui)
    const map: Record<string, number> = {};
    (absRows as any[]).forEach(r => { map[r.date_cours] = r.nb; });
    const today = new Date();
    const vals = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today); d.setDate(today.getDate() - (6 - i));
      return map[d.toISOString().slice(0, 10)] || 0;
    });
    setAbsJour(vals);
  }

  async function handleRefresh() {
    setRefresh(true);
    try {
      await syncService.syncComplete();
    } catch {
      setStatutSync('erreur');
    }
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

        <SyncStatus statut={statutSync} nbEnAttente={stats.notes_en_attente} onPresser={handleRefresh} />

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatCard titre="Classes" valeur={stats.nb_classes} icone="school-outline" couleur={Colors.primary} index={0} />
          <StatCard titre="À synchroniser" valeur={stats.notes_en_attente} icone="cloud-upload-outline" couleur={stats.notes_en_attente > 0 ? Colors.warning : Colors.success} onPress={stats.notes_en_attente > 0 ? handleRefresh : undefined} index={1} />
        </View>

        {/* Sparkline absences 7 jours */}
        {absJour.some(v => v > 0) && (
          <Carte style={styles.sparklineCarte} padding={12}>
            <Text style={styles.sparklineTitre}>Absences — 7 derniers jours</Text>
            <View style={styles.sparklineRow}>
              {absJour.map((v, i) => {
                const max = Math.max(...absJour, 1);
                const pct = v / max;
                const isToday = i === 6;
                return (
                  <View key={i} style={styles.sparklineCol}>
                    <View style={styles.sparklineBarBg}>
                      <View style={[styles.sparklineBar, { height: `${Math.max(pct * 100, 4)}%`, backgroundColor: isToday ? Colors.danger : Colors.danger + '60' }]} />
                    </View>
                    <Text style={[styles.sparklineVal, isToday && { color: Colors.danger, fontWeight: Typography.bold }]}>{v > 0 ? v : ''}</Text>
                  </View>
                );
              })}
            </View>
          </Carte>
        )}

        {/* Actions rapides */}
        <Text style={styles.sectionTitre}>Actions rapides</Text>
        <View style={styles.actionsGrid}>
          {[
            { icon: 'checkmark-circle-outline', label: 'Faire l\'appel', couleur: Colors.accent, route: '/(app)/enseignant/appel' },
            { icon: 'create-outline',           label: 'Saisir notes',   couleur: Colors.blue,   route: '/(app)/enseignant/notes-saisie' },
            { icon: 'bar-chart-outline',        label: 'Moyennes',       couleur: Colors.primary, route: '/(app)/enseignant/moyennes' },
            { icon: 'people-outline',            label: 'Classes',        couleur: Colors.success, route: '/(app)/enseignant/classes' },
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
          ? <EmptyState icone="calendar-outline" titre={`Aucun cours ce ${JOURS[jourActif]}`} sousTitre="Votre emploi du temps est libre pour cette journée." />
          : <FlatList
              data={coursJour}
              scrollEnabled={false}
              keyExtractor={(c) => c.id}
              renderItem={({ item: c }) => (
                <TouchableOpacity activeOpacity={0.85} onPress={() => router.push({ pathname: '/(app)/enseignant/appel', params: { cours_id: c.id, classe: c.classe } })}>
                  <Carte style={{ ...styles.coursCard, borderLeftColor: couleurMatiere(c.matiere) }} padding={12}>
                    <View style={styles.coursLigne}>
                      <View style={[styles.coursHeure, { backgroundColor: couleurMatiere(c.matiere) + '15' }]}>
                        <Text style={[styles.coursHeureTxt, { color: couleurMatiere(c.matiere) }]}>{c.heure_debut?.slice(0,5)}</Text>
                        <Text style={[styles.coursHeureFin, { color: couleurMatiere(c.matiere) }]}>{c.heure_fin?.slice(0,5)}</Text>
                      </View>
                      <View style={styles.coursInfo}>
                        <Text style={styles.coursMatiere}>{c.matiere}</Text>
                        <Text style={styles.coursClasse}>{c.classe}{c.salle ? ' · ' + c.salle : ''}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={Colors.gray400} />
                    </View>
                  </Carte>
                </TouchableOpacity>
              )}
            />
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
  sparklineCarte: { marginBottom: Spacing.md },
  sparklineTitre: { fontSize: Typography.xs, fontWeight: Typography.semibold, color: Colors.gray500, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 },
  sparklineRow:   { flexDirection: 'row', alignItems: 'flex-end', height: 48, gap: 4 },
  sparklineCol:   { flex: 1, alignItems: 'center', height: '100%' },
  sparklineBarBg: { flex: 1, width: '100%', justifyContent: 'flex-end' },
  sparklineBar:   { width: '100%', borderRadius: 3, minHeight: 2 },
  sparklineVal:   { fontSize: 9, color: Colors.gray400, marginTop: 3 },
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
});
