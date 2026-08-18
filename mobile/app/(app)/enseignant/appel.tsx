// app/(app)/enseignant/appel.tsx
// Écran de saisie des présences — cœur du système de notifications parents
import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Toast from 'react-native-toast-message';
import { getDB, sauvegarderPresenceLocale, ajouterOperationPendante } from '../../../src/services/storage/database';
import { enseignantApi } from '../../../src/services/api/client';
import { syncService } from '../../../src/services/sync/syncService';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import { VARIANT_PRESENCE, LABEL_PRESENCE } from '../../../src/components/ui/Badge';
import EmptyState from '../../../src/components/ui/EmptyState';

type Statut = 'present' | 'absent' | 'retard' | 'dispense' | 'non_saisi';
const STATUTS: { code: Statut; label: string; couleur: string; icone: string }[] = [
  { code: 'present',  label: 'Présent',  couleur: Colors.success, icone: 'checkmark-circle' },
  { code: 'absent',   label: 'Absent',   couleur: Colors.danger,  icone: 'close-circle' },
  { code: 'retard',   label: 'Retard',   couleur: Colors.warning, icone: 'time' },
  { code: 'dispense', label: 'Dispensé', couleur: Colors.info,    icone: 'medical' },
];

interface Presence {
  id: string; appel_id: string; inscription_id: string; eleve_id: string;
  eleve_nom: string; eleve_prenom: string; statut: Statut; minutes_retard: number;
}

export default function AppelScreen() {
  const { cours_id, classe, date } = useLocalSearchParams<{ cours_id: string; classe: string; date?: string }>();
  const router = useRouter();
  const dateAujourd = date || new Date().toISOString().slice(0, 10);

  const [presences, setPresences] = useState<Presence[]>([]);
  const [appelId,   setAppelId]   = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [recherche, setRecherche] = useState('');

  useEffect(() => { initialiserAppel(); }, [cours_id]);

  async function initialiserAppel() {
    setLoading(true);
    try {
      const db = getDB();
      // Vérifier si un appel existe déjà localement
      const existant: any = await db.getFirstAsync(
        'SELECT id FROM appels WHERE cours_id=? AND date_cours=?', [cours_id, dateAujourd]
      );

      let appId: string;
      if (existant) {
        appId = existant.id;
      } else {
        // Créer l\'appel via API (ou en local si hors ligne)
        try {
          const res: any = await enseignantApi.ouvrirAppel({ emploi_du_temps_id: cours_id, date_cours: dateAujourd });
          appId = res.appel_id || res.id;
        } catch {
          appId = 'local_' + Date.now();
          await db.runAsync('INSERT INTO appels (id, cours_id, date_cours, classe, statut) VALUES (?,?,?,?,?)',
            [appId, cours_id, dateAujourd, classe, 'ouvert']);
        }
      }
      setAppelId(appId);
      // Charger les présences depuis SQLite
      const rows: any[] = await db.getAllAsync(
        'SELECT * FROM presences WHERE appel_id=? ORDER BY eleve_nom, eleve_prenom', [appId]
      );
      setPresences(rows);
    } finally { setLoading(false); }
  }

  function changerStatut(inscriptionId: string, statut: Statut) {
    setPresences(prev => prev.map(p =>
      p.inscription_id === inscriptionId ? { ...p, statut } : p
    ));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  async function sauvegarder(cloturer = false) {
    if (!appelId) return;
    setSaving(true);
    try {
      const db = getDB();
      // Sauvegarder localement
      for (const p of presences) {
        await sauvegarderPresenceLocale({ ...p, eleve_nom: p.eleve_nom, eleve_prenom: p.eleve_prenom });
        // Enqueuer pour sync si absent/retard (notification parent)
        if (p.statut === 'absent' || p.statut === 'retard') {
          await ajouterOperationPendante('presences.saisir', {
            appel_id: appelId, inscription_id: p.inscription_id, statut: p.statut
          });
        }
      }

      // Tenter l\'envoi en ligne
      try {
        await enseignantApi.saisirPresences(appelId, presences.map(p => ({
          inscription_id: p.inscription_id, statut: p.statut, minutes_retard: p.minutes_retard
        })), cloturer);
        // Sync montante réussie — vider les opérations de CET appel uniquement
        await db.runAsync(
          `DELETE FROM operations_pending WHERE type='presences.saisir' AND payload LIKE ?`,
          [`%"appel_id":"${appelId}"%`]
        );
      } catch {
        // Hors ligne — la sync montante enverra au prochain passage
      }

      if (cloturer) {
        Alert.alert('Appel clôturé', 'Les parents des élèves absents ont été notifiés.', [
          { text: 'OK', onPress: () => router.back() }
        ]);
      } else {
        Toast.show({ type: 'success', text1: 'Sauvegardé', text2: 'Les présences ont été enregistrées.' });
      }
    } finally { setSaving(false); }
  }

  const filtrees = recherche
    ? presences.filter(p => (p.eleve_nom + ' ' + p.eleve_prenom).toLowerCase().includes(recherche.toLowerCase()))
    : presences;

  const stats = { presents: presences.filter(p => p.statut === 'present').length, absents: presences.filter(p => p.statut === 'absent').length };

  function renderEleve({ item: p }: { item: Presence }) {
    return (
      <View style={styles.eleveCard}>
        <View style={styles.eleveInfo}>
          <View style={[styles.eleveAvatar, { backgroundColor: Colors.primary + '15' }]}>
            <Text style={styles.eleveInitiale}>{p.eleve_prenom?.[0]}{p.eleve_nom?.[0]}</Text>
          </View>
          <Text style={styles.eleveNom} numberOfLines={1}>{p.eleve_prenom} {p.eleve_nom}</Text>
        </View>
        <View style={styles.statutsRow}>
          {STATUTS.map(s => (
            <TouchableOpacity key={s.code} onPress={() => changerStatut(p.inscription_id, s.code)}
              style={[styles.statutBtn, p.statut === s.code && { backgroundColor: s.couleur + '20', borderColor: s.couleur }]}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}>
              <Ionicons name={s.icone as any} size={20} color={p.statut === s.code ? s.couleur : Colors.gray300} />
            </TouchableOpacity>
          ))}
        </View>
      </View>
    );
  }

  if (loading) return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Entete titre="Appel" sousTitre={classe} retour />
      <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Entete titre="Appel" sousTitre={`${classe} · ${dateAujourd}`} retour />

      {/* Stats rapides */}
      <View style={styles.statsBar}>
        <View style={[styles.statItem, { backgroundColor: Colors.successLight }]}>
          <Text style={[styles.statNum, { color: Colors.success }]}>{stats.presents}</Text>
          <Text style={styles.statLbl}>Présents</Text>
        </View>
        <View style={[styles.statItem, { backgroundColor: Colors.dangerLight }]}>
          <Text style={[styles.statNum, { color: Colors.danger }]}>{stats.absents}</Text>
          <Text style={styles.statLbl}>Absents</Text>
        </View>
        <View style={[styles.statItem, { backgroundColor: Colors.gray100 }]}>
          <Text style={[styles.statNum, { color: Colors.gray600 }]}>{presences.length}</Text>
          <Text style={styles.statLbl}>Total</Text>
        </View>
      </View>

      {/* Légende */}
      <View style={styles.legende}>
        {STATUTS.map(s => (
          <View key={s.code} style={styles.legendeItem}>
            <Ionicons name={s.icone as any} size={14} color={s.couleur} />
            <Text style={[styles.legendeLabel, { color: s.couleur }]}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Recherche */}
      <View style={styles.rechercheContainer}>
        <Ionicons name="search-outline" size={16} color={Colors.gray400} />
        <TextInput style={styles.rechercheInput} placeholder="Rechercher un élève…" placeholderTextColor={Colors.gray400}
          value={recherche} onChangeText={setRecherche} />
        {recherche.length > 0 && <TouchableOpacity onPress={() => setRecherche('')}><Ionicons name="close-circle" size={16} color={Colors.gray400} /></TouchableOpacity>}
      </View>

      {/* Liste élèves */}
      <FlatList
        data={filtrees}
        keyExtractor={p => p.inscription_id}
        renderItem={renderEleve}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          recherche
            ? <EmptyState icone="search-outline" titre="Aucun élève trouvé" sousTitre={`Aucun résultat pour "${recherche}"`} action={{ label: 'Effacer la recherche', onPress: () => setRecherche('') }} />
            : <EmptyState icone="people-outline" titre="Aucun élève" sousTitre="La liste de présences est vide pour ce cours." />
        }
      />

      {/* Boutons d\'action */}
      <View style={styles.footer}>
        <TouchableOpacity style={[styles.btnSauv, Shadow.md]} onPress={() => sauvegarder(false)} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.white} /> : (
            <><Ionicons name="save-outline" size={18} color={Colors.white} /><Text style={styles.btnLabel}>Sauvegarder</Text></>
          )}
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btnCloturer, Shadow.md]} onPress={() => sauvegarder(true)} disabled={saving}>
          <Ionicons name="checkmark-done" size={18} color={Colors.white} />
          <Text style={styles.btnLabel}>Clôturer + Notifier</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  statsBar: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 8 },
  statItem: { flex: 1, borderRadius: Radius.sm, padding: Spacing.sm, alignItems: 'center' },
  statNum:  { fontSize: Typography.xl, fontWeight: Typography.bold },
  statLbl:  { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2 },
  legende:  { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: 12 },
  legendeItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendeLabel: { fontSize: Typography.xs, fontWeight: Typography.medium },
  rechercheContainer: { flexDirection: 'row', alignItems: 'center', marginHorizontal: Spacing.md, marginBottom: Spacing.sm,
    backgroundColor: Colors.white, borderRadius: Radius.md, paddingHorizontal: 12, height: 40, gap: 8, borderWidth: 1, borderColor: Colors.gray200 },
  rechercheInput: { flex: 1, fontSize: Typography.sm, color: Colors.gray900 },
  liste:  { paddingHorizontal: Spacing.md, paddingBottom: 120 },
  eleveCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.md,
    marginBottom: 6, paddingVertical: 10, paddingHorizontal: 12, ...Shadow.sm },
  eleveInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  eleveAvatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  eleveInitiale: { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.primary },
  eleveNom: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.gray900, flex: 1 },
  statutsRow: { flexDirection: 'row', gap: 6 },
  statutBtn: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: Colors.gray200, alignItems: 'center', justifyContent: 'center' },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, flexDirection: 'row', gap: 10,
    padding: Spacing.md, paddingBottom: Spacing.lg, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.gray100 },
  btnSauv: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.gray600, borderRadius: Radius.md, height: 48 },
  btnCloturer: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 48 },
  btnLabel: { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.white },
});
