// app/(app)/parent/index.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView, RefreshControl } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuthStore } from '../../../src/stores/authStore';
import { syncService } from '../../../src/services/sync/syncService';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
import Carte from '../../../src/components/ui/Carte';
import Badge, { VARIANT_PRESENCE, LABEL_PRESENCE, VARIANT_MENTION } from '../../../src/components/ui/Badge';
import NoteBulle from '../../../src/components/ui/NoteBulle';
import StatCard from '../../../src/components/ui/StatCard';
import SyncStatus, { StatutSync } from '../../../src/components/ui/SyncStatus';
import EmptyState from '../../../src/components/ui/EmptyState';

export default function TableauBordParent() {
  const session  = useAuthStore(s => s.session);
  const router   = useRouter();
  const [enfants, setEnfants]          = useState<any[]>([]);
  const [enfantActif, setEnfantActif]  = useState<string | null>(null);
  const [absences, setAbsences]        = useState<any[]>([]);
  const [notesRec, setNotesRec]        = useState<any[]>([]);
  const [bulletins, setBulletins]      = useState<any[]>([]);
  const [moyennes, setMoyennes]        = useState<any[]>([]);
  const [refresh,  setRefresh]         = useState(false);
  const [statutSync, setStatutSync]    = useState<StatutSync>('ok');

  useEffect(() => { charger(); }, []);
  useEffect(() => { if (enfantActif) chargerEnfant(enfantActif); }, [enfantActif]);

  async function charger() {
    const db    = getDB();
    const rows: any[] = await db.getAllAsync('SELECT * FROM eleves ORDER BY nom, prenom');
    setEnfants(rows);
    if (rows.length > 0 && !enfantActif) setEnfantActif(rows[0].id);
  }

  async function chargerEnfant(eleveId: string) {
    const db = getDB();
    const [abs, notes, bull, moy] = await Promise.all([
      db.getAllAsync('SELECT * FROM absences WHERE eleve_id=? ORDER BY date_cours DESC LIMIT 20', [eleveId]),
      db.getAllAsync('SELECT * FROM notes_parent WHERE eleve_id=? ORDER BY date_evaluation DESC LIMIT 8', [eleveId]),
      db.getAllAsync('SELECT * FROM bulletins WHERE eleve_id=? ORDER BY trimestre DESC', [eleveId]),
      db.getAllAsync('SELECT * FROM moyennes WHERE eleve_id=? ORDER BY matiere', [eleveId]),
    ]);
    setAbsences(abs as any[]);
    setNotesRec(notes as any[]);
    setBulletins(bull as any[]);
    setMoyennes(moy as any[]);
  }

  async function handleRefresh() {
    setRefresh(true);
    try {
      await syncService.syncComplete();
      setStatutSync('ok');
    } catch {
      setStatutSync('erreur');
    }
    await charger();
    if (enfantActif) await chargerEnfant(enfantActif);
    setRefresh(false);
  }

  const enfant     = enfants.find(e => e.id === enfantActif);
  const nbAbsents  = absences.filter(a => !a.est_justifie).length;
  const latestBull = bulletins[0];

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refresh} onRefresh={handleRefresh} colors={[Colors.primary]} tintColor={Colors.primary} />}
      >
        {/* En-tête parent */}
        <View style={styles.header}>
          <View>
            <Text style={styles.bonjour}>Bonjour,</Text>
            <Text style={styles.nom}>{session?.nom_complet}</Text>
          </View>
          <TouchableOpacity onPress={() => router.push('/(app)/commun/profil')} style={styles.avatarBtn}>
            <View style={styles.avatar}>
              <Ionicons name="people" size={22} color={Colors.white} />
            </View>
          </TouchableOpacity>
        </View>

        <SyncStatus statut={statutSync} onPresser={handleRefresh} />

        {/* Sélecteur enfant (multi-enfants) */}
        {enfants.length > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.enfantsScroll}>
            {enfants.map(e => (
              <TouchableOpacity key={e.id} style={[styles.enfantBtn, e.id === enfantActif && styles.enfantBtnActif]}
                onPress={() => setEnfantActif(e.id)}>
                <View style={[styles.enfantAvatar, { backgroundColor: e.id === enfantActif ? Colors.primary : Colors.gray100 }]}>
                  <Text style={[styles.enfantInitiale, { color: e.id === enfantActif ? Colors.white : Colors.gray500 }]}>
                    {e.prenom?.[0]}{e.nom?.[0]}
                  </Text>
                </View>
                <Text style={[styles.enfantNom, e.id === enfantActif && styles.enfantNomActif]} numberOfLines={1}>{e.prenom}</Text>
                <Text style={styles.enfantClasse}>{e.classe}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {enfantActif && (
          <>
            {/* Carte bulletin dernier */}
            {latestBull && (
              <TouchableOpacity activeOpacity={0.85} onPress={() => router.push({ pathname: '/(app)/parent/bulletins', params: { eleve_id: enfantActif } })}>
                <View style={[styles.bulletinCard, Shadow.md]}>
                  <View style={styles.bulletinLeft}>
                    <Text style={styles.bulletinTitre}>Trimestre {latestBull.trimestre}</Text>
                    <Text style={styles.bulletinMention}>{latestBull.mention?.replace(/_/g, ' ') || '—'}</Text>
                    <Text style={styles.bulletinRang}>Rang : {latestBull.rang}/{latestBull.rang_sur}</Text>
                  </View>
                  <NoteBulle note={latestBull.moyenne_generale} taille="lg" />
                </View>
              </TouchableOpacity>
            )}

            {/* Stats rapides */}
            <View style={styles.statsRow}>
              <StatCard titre="Absences" valeur={nbAbsents} icone="warning-outline" couleur={nbAbsents > 3 ? Colors.danger : Colors.warning}
                onPress={() => router.push({ pathname: '/(app)/parent/absences', params: { eleve_id: enfantActif } })} index={0} />
              <StatCard titre="Notes" valeur={notesRec.length} icone="document-text-outline" couleur={Colors.blue}
                onPress={() => router.push({ pathname: '/(app)/parent/notes', params: { eleve_id: enfantActif } })} index={1} />
            </View>

            {/* Dernières absences */}
            {absences.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitre}>Absences récentes</Text>
                  <TouchableOpacity onPress={() => router.push({ pathname: '/(app)/parent/absences', params: { eleve_id: enfantActif } })}>
                    <Text style={styles.voirTout}>Voir tout</Text>
                  </TouchableOpacity>
                </View>
                {absences.slice(0, 3).map((a, i) => (
                  <Carte key={i} padding={12} style={styles.absenceCard}>
                    <View style={styles.absenceLigne}>
                      <View style={[styles.absenceIcoCont, { backgroundColor: a.est_justifie ? Colors.successLight : Colors.dangerLight }]}>
                        <Ionicons name={a.est_justifie ? 'checkmark-circle' : 'warning'} size={20} color={a.est_justifie ? Colors.success : Colors.danger} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.absenceMatiere}>{a.matiere || 'Non renseigné'}</Text>
                        <Text style={styles.absenceDate}>{new Date(a.date_cours).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
                      </View>
                      <Badge label={a.est_justifie ? 'Justifiée' : 'Non justifiée'} variant={a.est_justifie ? 'success' : 'danger'} />
                    </View>
                  </Carte>
                ))}
              </>
            )}

            {/* Dernières notes */}
            {notesRec.length > 0 && (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitre}>Dernières notes</Text>
                  <TouchableOpacity onPress={() => router.push({ pathname: '/(app)/parent/notes', params: { eleve_id: enfantActif } })}>
                    <Text style={styles.voirTout}>Voir tout</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
                  {notesRec.slice(0, 6).map((n, i) => (
                    <View key={i} style={[styles.noteBulle, Shadow.sm]}>
                      <NoteBulle note={n.valeur} taille="md" />
                      <Text style={styles.noteMatiere} numberOfLines={2}>{n.matiere}</Text>
                      <Text style={styles.noteType}>{n.type_eval}</Text>
                    </View>
                  ))}
                </ScrollView>
              </>
            )}

            {/* Moyennes par matière */}
            {moyennes.length > 0 && (
              <>
                <Text style={styles.sectionTitre}>Moyennes</Text>
                {moyennes.slice(0, 5).map((m, i) => (
                  <Carte key={i} padding={12} style={styles.matiereCard}>
                    <View style={styles.matiereLigne}>
                      <Text style={styles.matiereNom} numberOfLines={1}>{m.matiere}</Text>
                      <View style={styles.matiereRight}>
                        {m.rang_classe && <Text style={styles.matiereRang}>{m.rang_classe}e</Text>}
                        <View style={[styles.matiereNote, { backgroundColor: (couleurNote(m.moyenne) + '20') }]}>
                          <Text style={[styles.matiereNoteTxt, { color: couleurNote(m.moyenne) }]}>
                            {m.moyenne != null ? m.moyenne.toFixed(2) : '—'}
                          </Text>
                        </View>
                      </View>
                    </View>
                  </Carte>
                ))}
              </>
            )}

            {absences.length === 0 && notesRec.length === 0 && (
              <EmptyState
                icone="sync-outline"
                titre="Données en cours de chargement…"
                sousTitre="Tirez vers le bas pour actualiser"
                action={{ label: 'Actualiser', onPress: handleRefresh }}
              />
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:    { flex: 1, backgroundColor: Colors.background },
  scroll:  { flex: 1 },
  content: { paddingHorizontal: Spacing.md, paddingTop: Spacing.md, paddingBottom: 100 },
  header:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.lg },
  bonjour: { fontSize: Typography.sm, color: Colors.gray500 },
  nom:     { fontSize: Typography.xl, fontWeight: Typography.bold, color: Colors.gray900, marginTop: 2 },
  avatarBtn: {},
  avatar:  { width: 46, height: 46, borderRadius: 23, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  enfantsScroll: { marginBottom: Spacing.md },
  enfantBtn:     { alignItems: 'center', marginRight: 16, minWidth: 60 },
  enfantBtnActif: {},
  enfantAvatar:  { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  enfantInitiale:{ fontSize: Typography.sm, fontWeight: Typography.bold },
  enfantNom:     { fontSize: Typography.xs, fontWeight: Typography.medium, color: Colors.gray500, textAlign: 'center' },
  enfantNomActif:{ color: Colors.primary, fontWeight: Typography.bold },
  enfantClasse:  { fontSize: Typography.xs, color: Colors.gray400, textAlign: 'center' },
  bulletinCard:  { backgroundColor: Colors.primary, borderRadius: Radius.lg, padding: Spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Spacing.md },
  bulletinLeft:  { flex: 1 },
  bulletinTitre: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.white + 'CC' },
  bulletinMention:{ fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.white, marginVertical: 4, textTransform: 'capitalize' },
  bulletinRang:  { fontSize: Typography.sm, color: Colors.white + 'AA' },
  statsRow:      { flexDirection: 'row', marginBottom: Spacing.md },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.sm, marginTop: 4 },
  sectionTitre:  { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.gray900 },
  voirTout:      { fontSize: Typography.sm, color: Colors.accent, fontWeight: Typography.medium },
  absenceCard:   { marginBottom: 6 },
  absenceLigne:  { flexDirection: 'row', alignItems: 'center', gap: 12 },
  absenceIcoCont:{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  absenceMatiere:{ fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.gray900 },
  absenceDate:   { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2 },
  noteBulle:     { backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.sm, marginRight: 10, alignItems: 'center', minWidth: 80, maxWidth: 90 },
  noteMatiere:   { fontSize: Typography.xs, color: Colors.gray600, textAlign: 'center', marginTop: 6, fontWeight: Typography.medium },
  noteType:      { fontSize: Typography.xs, color: Colors.gray400, textAlign: 'center' },
  matiereCard:   { marginBottom: 6 },
  matiereLigne:  { flexDirection: 'row', alignItems: 'center' },
  matiereNom:    { flex: 1, fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.gray900 },
  matiereRight:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  matiereRang:   { fontSize: Typography.xs, color: Colors.gray400 },
  matiereNote:   { paddingHorizontal: 12, paddingVertical: 4, borderRadius: Radius.full },
  matiereNoteTxt:{ fontSize: Typography.sm, fontWeight: Typography.bold },
});
