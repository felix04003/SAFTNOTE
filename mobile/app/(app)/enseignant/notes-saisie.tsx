// app/(app)/enseignant/notes-saisie.tsx
import React, { useState, useEffect, useRef } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import { getDB, sauvegarderNoteLocale, ajouterOperationPendante } from '../../../src/services/storage/database';
import { enseignantApi } from '../../../src/services/api/client';
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';

interface NoteEleve {
  eleve_id: string; inscription_id: string;
  nom: string; prenom: string;
  valeur: string; est_absent: boolean; absence_justifiee: boolean;
}

export default function NotesSaisieScreen() {
  const { evaluation_id, matiere, classe, type_eval, note_max } = useLocalSearchParams<any>();
  const router  = useRouter();
  const noteMax = parseFloat(note_max || '20');

  const [notes,    setNotes]    = useState<NoteEleve[]>([]);
  const [saving,   setSaving]   = useState(false);
  const [loading,  setLoading]  = useState(true);
  const inputRefs  = useRef<Map<string, TextInput>>(new Map());

  useEffect(() => { charger(); }, [evaluation_id]);

  async function charger() {
    const db = getDB();
    // Charger les élèves avec leurs notes existantes
    const eleves: any[] = await db.getAllAsync(
      `SELECT e.id, e.nom, e.prenom, e.inscription_id,
              n.valeur, n.est_absent, n.absence_justifiee
       FROM eleves e
       LEFT JOIN notes n ON n.eleve_id=e.id AND n.evaluation_id=?
       ORDER BY e.nom, e.prenom`, [evaluation_id]
    );
    setNotes(eleves.map(e => ({
      eleve_id:         e.id,
      inscription_id:   e.inscription_id,
      nom:              e.nom,
      prenom:           e.prenom,
      valeur:           e.valeur != null ? String(e.valeur) : '',
      est_absent:       !!e.est_absent,
      absence_justifiee: !!e.absence_justifiee,
    })));
    setLoading(false);
  }

  function majNote(eleveId: string, champ: keyof NoteEleve, valeur: any) {
    setNotes(prev => prev.map(n => n.eleve_id === eleveId ? { ...n, [champ]: valeur } : n));
  }

  function validerSaisie(txt: string): boolean {
    if (txt === '' || txt === '-') return true;
    const v = parseFloat(txt);
    return !isNaN(v) && v >= 0 && v <= noteMax;
  }

  async function sauvegarder() {
    // Valider toutes les notes avant de sauvegarder
    const invalides = notes.filter(n => !n.est_absent && n.valeur !== '' && !validerSaisie(n.valeur));
    if (invalides.length > 0) {
      Alert.alert('Notes invalides', `${invalides.length} note(s) hors de la plage 0-${noteMax}`); return;
    }

    setSaving(true);
    try {
      const notesPayload = notes.map(n => ({
        id:                Crypto.randomUUID(),
        evaluation_id,
        eleve_id:          n.eleve_id,
        inscription_id:    n.inscription_id,
        valeur:            n.est_absent ? (n.absence_justifiee ? null : 0) : (n.valeur !== '' ? parseFloat(n.valeur) : null),
        est_absent:        n.est_absent,
        absence_justifiee: n.absence_justifiee,
      }));

      // Sauvegarder localement en priorité
      for (const n of notesPayload) {
        await sauvegarderNoteLocale(n as any);
      }

      // Tenter envoi API
      try {
        await enseignantApi.saisirNotes(evaluation_id, notesPayload);
        // Marquer comme synchronisées
        const db = getDB();
        await db.runAsync("UPDATE notes SET synced=1 WHERE evaluation_id=?", [evaluation_id]);
      } catch {
        // Enqueuer pour sync différée
        await ajouterOperationPendante('notes.saisir_batch', { evaluation_id, notes: notesPayload });
      }

      Alert.alert('Sauvegardé ✓', `${notes.filter(n => n.valeur !== '' || n.est_absent).length} notes enregistrées.`, [
        { text: 'OK', onPress: () => router.back() }
      ]);
    } finally { setSaving(false); }
  }

  const nbSaisies  = notes.filter(n => n.valeur !== '' && !n.est_absent).length;
  const nbAbsents  = notes.filter(n => n.est_absent).length;
  const moyenneCalc = nbSaisies > 0
    ? notes.filter(n => n.valeur !== '' && !n.est_absent).reduce((s, n) => s + parseFloat(n.valeur), 0) / nbSaisies
    : null;

  function renderNote({ item: n, index }: { item: NoteEleve; index: number }) {
    const noteNum = n.valeur !== '' ? parseFloat(n.valeur) : null;
    const couleur = n.est_absent ? Colors.gray300 : couleurNote(noteNum);

    return (
      <View style={[styles.ligne, index % 2 === 0 && styles.ligneAlternee]}>
        <View style={styles.eleveInfo}>
          <View style={[styles.numBulle, { backgroundColor: Colors.primary + '15' }]}>
            <Text style={styles.numTxt}>{index + 1}</Text>
          </View>
          <Text style={styles.eleveNom} numberOfLines={1}>{n.prenom} {n.nom}</Text>
        </View>

        {n.est_absent ? (
          <View style={styles.absentInfo}>
            <Text style={styles.absentLabel}>Absent</Text>
            <TouchableOpacity
              style={[styles.justifBtn, n.absence_justifiee && styles.justifBtnActif]}
              onPress={() => majNote(n.eleve_id, 'absence_justifiee', !n.absence_justifiee)}>
              <Text style={[styles.justifLabel, n.absence_justifiee && styles.justifLabelActif]}>
                {n.absence_justifiee ? 'Justifié' : 'Injustifié'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => majNote(n.eleve_id, 'est_absent', false)}>
              <Ionicons name="close-circle" size={20} color={Colors.danger} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.saisieRow}>
            <View style={[styles.noteInput, { borderColor: n.valeur !== '' && !validerSaisie(n.valeur) ? Colors.danger : couleur + '80' }]}>
              <TextInput
                ref={r => { if(r) inputRefs.current.set(n.eleve_id, r); }}
                style={[styles.noteInputTxt, { color: couleur }]}
                value={n.valeur}
                onChangeText={val => majNote(n.eleve_id, 'valeur', val.replace(',', '.'))}
                keyboardType="decimal-pad"
                placeholder="—"
                placeholderTextColor={Colors.gray300}
                returnKeyType="next"
                onSubmitEditing={() => {
                  const keys = Array.from(inputRefs.current.keys());
                  const idx  = keys.indexOf(n.eleve_id);
                  if (idx < keys.length - 1) inputRefs.current.get(keys[idx + 1])?.focus();
                }}
              />
              <Text style={styles.noteMax}>/{noteMax}</Text>
            </View>
            <TouchableOpacity
              style={styles.absentBtn}
              onPress={() => majNote(n.eleve_id, 'est_absent', true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="person-remove-outline" size={18} color={Colors.gray400} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre={matiere || 'Saisie notes'} sousTitre={`${classe} · ${type_eval || 'Devoir'} · /${noteMax}`} retour />

      <View style={styles.barre}>
        <Text style={styles.barreItem}><Text style={styles.barreNum}>{nbSaisies}</Text> notés</Text>
        <Text style={styles.barreItem}><Text style={[styles.barreNum, { color: Colors.danger }]}>{nbAbsents}</Text> absents</Text>
        {moyenneCalc !== null && (
          <Text style={styles.barreItem}>Moy: <Text style={[styles.barreNum, { color: couleurNote(moyenneCalc) }]}>{moyenneCalc.toFixed(2)}</Text></Text>
        )}
      </View>

      {loading
        ? <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
        : (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <FlatList
              data={notes}
              keyExtractor={n => n.eleve_id}
              renderItem={renderNote}
              contentContainerStyle={styles.liste}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={<Text style={styles.empty}>Aucun élève dans cette classe</Text>}
            />
          </KeyboardAvoidingView>
        )
      }

      <View style={styles.footer}>
        <TouchableOpacity style={[styles.btnSauv, Shadow.md, saving && { opacity: 0.6 }]} onPress={sauvegarder} disabled={saving}>
          {saving ? <ActivityIndicator color={Colors.white} />
            : <><Ionicons name="cloud-upload-outline" size={18} color={Colors.white} /><Text style={styles.btnLabel}>Enregistrer les notes</Text></>
          }
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  barre: { flexDirection: 'row', justifyContent: 'space-around', backgroundColor: Colors.white,
    paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.gray100 },
  barreItem:  { fontSize: Typography.sm, color: Colors.gray600 },
  barreNum:   { fontWeight: Typography.bold, color: Colors.primary },
  liste:      { paddingBottom: 100 },
  ligne:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: 10, gap: 10 },
  ligneAlternee: { backgroundColor: Colors.gray50 },
  eleveInfo:  { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  numBulle:   { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  numTxt:     { fontSize: Typography.xs, fontWeight: Typography.bold, color: Colors.primary },
  eleveNom:   { fontSize: Typography.sm, color: Colors.gray700, fontWeight: Typography.medium, flex: 1 },
  noteInput:  { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5, borderRadius: Radius.sm,
    backgroundColor: Colors.white, paddingHorizontal: 8, height: 40, minWidth: 80 },
  noteInputTxt: { fontSize: Typography.md, fontWeight: Typography.bold, minWidth: 40, textAlign: 'center' },
  noteMax:    { fontSize: Typography.xs, color: Colors.gray400 },
  absentBtn:  { padding: 6, marginLeft: 4 },
  saisieRow:  { flexDirection: 'row', alignItems: 'center', gap: 4 },
  absentInfo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  absentLabel:{ fontSize: Typography.sm, color: Colors.danger, fontWeight: Typography.medium },
  justifBtn:  { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.gray300 },
  justifBtnActif: { backgroundColor: Colors.successLight, borderColor: Colors.success },
  justifLabel: { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  justifLabelActif: { color: Colors.success },
  empty:      { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm },
  footer:     { position: 'absolute', bottom: 0, left: 0, right: 0, padding: Spacing.md, paddingBottom: Spacing.lg,
    backgroundColor: Colors.white, borderTopWidth: 1, borderTopColor: Colors.gray100 },
  btnSauv:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: Radius.md, height: 52 },
  btnLabel:   { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.white },
});
