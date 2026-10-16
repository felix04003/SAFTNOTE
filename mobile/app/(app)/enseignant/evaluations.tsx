// app/(app)/enseignant/evaluations.tsx
// Liste des évaluations + création d\'une nouvelle
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert, TextInput, Modal, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { creerEvaluationMobile } from '../../../src/services/evaluations/creerEvaluation';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import Badge from '../../../src/components/ui/Badge';
import Carte from '../../../src/components/ui/Carte';

const TYPES_EVAL = [
  { code: 'devoir',       label: 'Devoir', couleur: Colors.blue },
  { code: 'composition',  label: 'Composition', couleur: Colors.primary },
  { code: 'interrogation',label: 'Interrogation', couleur: Colors.accent },
  { code: 'tp',           label: 'TP / Pratique', couleur: Colors.success },
  { code: 'expose',       label: 'Exposé', couleur: Colors.warning },
  { code: 'projet',       label: 'Projet', couleur: Colors.info },
];

const COULEUR_TYPE: Record<string, string> = TYPES_EVAL.reduce((acc, t) => ({ ...acc, [t.code]: t.couleur }), {} as any);

export default function EvaluationsScreen() {
  const router = useRouter();
  const [evaluations, setEvaluations] = useState<any[]>([]);
  const [classes,     setClasses]     = useState<any[]>([]);
  const [affectations, setAffectations] = useState<any[]>([]);
  const [classeFiltre, setClasseFiltre] = useState<string>('toutes');
  const [modal,       setModal]       = useState(false);
  const [saving,      setSaving]      = useState(false);

  // Formulaire création
  const [form, setForm] = useState({
    classe_id: '', type: 'devoir',
    titre: '', date_evaluation: new Date().toISOString().slice(0, 10),
    note_max: '20', affectation_id: '',
  });

  useEffect(() => { charger(); }, []);

  async function charger() {
    const db = getDB();
    const [evals, cls, affs] = await Promise.all([
      db.getAllAsync('SELECT * FROM evaluations ORDER BY date_evaluation DESC'),
      db.getAllAsync('SELECT DISTINCT classe_id, classe FROM affectations WHERE classe IS NOT NULL ORDER BY classe'),
      db.getAllAsync('SELECT * FROM affectations ORDER BY classe, matiere'),
    ]);
    setEvaluations(evals as any[]);
    setClasses(cls as any[]);
    setAffectations(affs as any[]);
  }

  async function creerEvaluation() {
    if (!form.affectation_id) {
      return Alert.alert('Champs manquants', 'La classe et la matière sont requises.');
    }
    setSaving(true);
    try {
      const { enLigne } = await creerEvaluationMobile({
        affectation_id:  form.affectation_id,
        type:            form.type,
        titre:           form.titre,
        date_evaluation: form.date_evaluation,
        note_max:        parseFloat(form.note_max) || 20,
      });
      const matiere = affectations.find(a => a.id === form.affectation_id)?.matiere ?? '';

      setModal(false);
      await charger();
      Alert.alert('Créée ✓', enLigne
        ? `L'évaluation de ${matiere} a été créée.`
        : `L'évaluation de ${matiere} est enregistrée sur ce téléphone et sera envoyée au retour du réseau.`);
    } catch (e: any) {
      Alert.alert('Création impossible', e?.message || 'Erreur inconnue');
    } finally { setSaving(false); }
  }

  const filtrees = classeFiltre === 'toutes'
    ? evaluations
    : evaluations.filter(e => e.classe === classeFiltre);

  function renderEval({ item: e }: { item: any }) {
    const couleur = COULEUR_TYPE[e.type] || Colors.primary;
    return (
      <TouchableOpacity activeOpacity={0.85}
        onPress={() => router.push({ pathname: '/(app)/enseignant/notes-saisie', params: { evaluation_id: e.id, matiere: e.matiere, classe: e.classe, type_eval: e.type, note_max: String(e.note_max) } })}>
        <Carte style={{ ...styles.evalCard, borderLeftColor: couleur }} padding={12}>
          <View style={styles.evalLigne}>
            <View style={[styles.typeIco, { backgroundColor: couleur + '15' }]}>
              <Ionicons name="document-text-outline" size={20} color={couleur} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.evalMatiere}>{e.matiere}</Text>
              <Text style={styles.evalClasse}>
                {e.classe} · {new Date(e.date_evaluation).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
              {e.titre && <Text style={styles.evalTitre}>{e.titre}</Text>}
            </View>
            <View style={styles.evalDroite}>
              <Badge label={TYPES_EVAL.find(t => t.code === e.type)?.label || e.type}
                variant={e.notes_publiees ? 'success' : 'neutral'} />
              <Text style={styles.evalNoteMax}>/{e.note_max}</Text>
              {!e.notes_publiees && (
                <Ionicons name="create-outline" size={18} color={Colors.gray400} style={{ marginTop: 4 }} />
              )}
            </View>
          </View>
        </Carte>
      </TouchableOpacity>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre="Évaluations" retour
        droite={
          <TouchableOpacity onPress={() => setModal(true)} style={styles.ajouterBtn}>
            <Ionicons name="add" size={24} color={Colors.white} />
          </TouchableOpacity>
        }
      />

      {/* Filtre classes */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtresScroll}>
        {[{ classe_id: 'toutes', classe: 'Toutes' }, ...classes].map(c => (
          <TouchableOpacity key={c.classe_id} style={[styles.filtreBtn, classeFiltre === (c.classe_id === 'toutes' ? 'toutes' : c.classe) && styles.filtreBtnActif]}
            onPress={() => setClasseFiltre(c.classe_id === 'toutes' ? 'toutes' : c.classe)}>
            <Text style={[styles.filtreLabel, classeFiltre === (c.classe_id === 'toutes' ? 'toutes' : c.classe) && styles.filtreLabelActif]}>
              {c.classe}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <FlatList
        data={filtrees}
        keyExtractor={e => e.id}
        renderItem={renderEval}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>Aucune évaluation{classeFiltre !== 'toutes' ? ' pour cette classe' : ''}</Text>}
      />

      {/* Modal création */}
      <Modal visible={modal} animationType="slide" transparent onRequestClose={() => setModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, Shadow.lg]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitre}>Nouvelle évaluation</Text>
              <TouchableOpacity onPress={() => setModal(false)}><Ionicons name="close" size={24} color={Colors.gray600} /></TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              {/* Type évaluation */}
              <Text style={styles.fieldLabel}>Type</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
                {TYPES_EVAL.map(t => (
                  <TouchableOpacity key={t.code} style={[styles.typeBtn, form.type === t.code && { backgroundColor: t.couleur + '20', borderColor: t.couleur }]}
                    onPress={() => setForm(f => ({ ...f, type: t.code }))}>
                    <Text style={[styles.typeBtnLabel, form.type === t.code && { color: t.couleur }]}>{t.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Classe */}
              <Text style={styles.fieldLabel}>Classe *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
                {classes.map(c => (
                  <TouchableOpacity key={c.classe_id} style={[styles.typeBtn, form.classe_id === c.classe_id && styles.typeBtnActif]}
                    onPress={() => setForm(f => ({ ...f, classe_id: c.classe_id, affectation_id: '' }))}>
                    <Text style={[styles.typeBtnLabel, form.classe_id === c.classe_id && { color: Colors.primary }]}>{c.classe}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Matière : seulement celles que l'enseignant donne dans cette classe */}
              <Text style={styles.fieldLabel}>Matière *</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: Spacing.sm }}>
                {affectations.filter(a => a.classe_id === form.classe_id).map(a => (
                  <TouchableOpacity key={a.id} style={[styles.typeBtn, form.affectation_id === a.id && styles.typeBtnActif]}
                    onPress={() => setForm(f => ({ ...f, affectation_id: a.id }))}>
                    <Text style={[styles.typeBtnLabel, form.affectation_id === a.id && { color: Colors.primary }]}>{a.matiere}</Text>
                  </TouchableOpacity>
                ))}
                {!form.classe_id && <Text style={styles.empty}>Choisissez d'abord une classe</Text>}
              </ScrollView>

              {/* Titre optionnel */}
              <Text style={styles.fieldLabel}>Titre (optionnel)</Text>
              <TextInput style={styles.fieldInput} value={form.titre}
                onChangeText={v => setForm(f => ({ ...f, titre: v }))} placeholder="Ex: Chapitre 3 — Algèbre" />

              {/* Date + Note max */}
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ flex: 2 }}>
                  <Text style={styles.fieldLabel}>Date</Text>
                  <TextInput style={styles.fieldInput} value={form.date_evaluation}
                    onChangeText={v => setForm(f => ({ ...f, date_evaluation: v }))} placeholder="AAAA-MM-JJ" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.fieldLabel}>Note max</Text>
                  <TextInput style={styles.fieldInput} value={form.note_max} keyboardType="decimal-pad"
                    onChangeText={v => setForm(f => ({ ...f, note_max: v }))} />
                </View>
              </View>

              <TouchableOpacity style={[styles.btnCreer, saving && { opacity: 0.6 }]} onPress={creerEvaluation} disabled={saving}>
                <Text style={styles.btnCreerLabel}>{saving ? 'Création…' : 'Créer l\'évaluation'}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:     { flex: 1, backgroundColor: Colors.background },
  ajouterBtn: { backgroundColor: Colors.white + '30', borderRadius: 20, padding: 4 },
  filtresScroll: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, maxHeight: 48 },
  filtreBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, marginRight: 8, borderWidth: 1.5, borderColor: Colors.gray200, backgroundColor: Colors.white },
  filtreBtnActif:{ borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  filtreLabel:   { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  filtreLabelActif: { color: Colors.primary },
  liste:    { paddingHorizontal: Spacing.md, paddingBottom: 40 },
  evalCard: { borderLeftWidth: 4, marginBottom: 8 },
  evalLigne:{ flexDirection: 'row', alignItems: 'center', gap: 10 },
  typeIco:  { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  evalMatiere: { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.gray900 },
  evalClasse:  { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2 },
  evalTitre:   { fontSize: Typography.xs, color: Colors.gray400, fontStyle: 'italic', marginTop: 1 },
  evalDroite:  { alignItems: 'flex-end', gap: 4 },
  evalNoteMax: { fontSize: Typography.xs, color: Colors.gray400 },
  empty:    { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm },
  modalOverlay:  { flex: 1, backgroundColor: '#00000060', justifyContent: 'flex-end' },
  modalContent:  { backgroundColor: Colors.white, borderTopLeftRadius: Radius.xl, borderTopRightRadius: Radius.xl, padding: Spacing.lg, maxHeight: '90%' },
  modalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: Spacing.md },
  modalTitre:    { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.gray900 },
  fieldLabel:    { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.gray700, marginBottom: 6, marginTop: 12 },
  fieldInput:    { borderWidth: 1.5, borderColor: Colors.gray200, borderRadius: Radius.md, paddingHorizontal: Spacing.sm, height: 46, fontSize: Typography.base, color: Colors.gray900, backgroundColor: Colors.gray50 },
  typeBtn:       { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, marginRight: 8, borderWidth: 1.5, borderColor: Colors.gray200, backgroundColor: Colors.white },
  typeBtnActif:  { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  typeBtnLabel:  { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  btnCreer:      { backgroundColor: Colors.primary, borderRadius: Radius.md, height: 52, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.lg, marginBottom: Spacing.md },
  btnCreerLabel: { fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.white },
});
