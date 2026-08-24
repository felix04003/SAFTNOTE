// app/(app)/enseignant/moyennes.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { getClassesDistinctes, getMatieresClasse, getMoyennesClasseMatiere } from '../../../src/services/storage/queries';
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import NoteBulle from '../../../src/components/ui/NoteBulle';
import Carte from '../../../src/components/ui/Carte';

interface MoyenneEleve {
  eleve_id: string; nom: string; prenom: string;
  nb_notes: number; moyenne: number | null;
}

export default function MoyennesScreen() {
  const [classes,     setClasses]     = useState<any[]>([]);
  const [classeActif, setClasseActif] = useState<string>('');
  const [matieres,    setMatieres]    = useState<string[]>([]);
  const [matiereActif, setMatiereActif] = useState<string>('');
  const [moyennes,    setMoyennes]    = useState<MoyenneEleve[]>([]);

  useEffect(() => { chargerClasses(); }, []);
  useEffect(() => { if (classeActif) chargerMatieres(classeActif); }, [classeActif]);
  useEffect(() => { if (classeActif && matiereActif) calculerMoyennes(); }, [classeActif, matiereActif]);

  async function chargerClasses() {
    const db  = getDB();
    const cls = await getClassesDistinctes(db);
    setClasses(cls);
    if (cls.length > 0) setClasseActif(cls[0].classe);
  }

  async function chargerMatieres(classe: string) {
    const db  = getDB();
    const mat = await getMatieresClasse(db, classe);
    const mats = mat.map(m => m.matiere);
    setMatieres(mats);
    if (mats.length > 0) setMatiereActif(mats[0]);
  }

  async function calculerMoyennes() {
    const db = getDB();
    // Récupérer tous les élèves de la classe avec leurs notes
    const rows = await getMoyennesClasseMatiere(db, classeActif, matiereActif);
    setMoyennes(rows.map((r, i) => ({ ...r, rang: i + 1 })));
  }

  const moyenneClasse = moyennes.length > 0
    ? moyennes.filter(m => m.moyenne != null).reduce((s, m) => s + (m.moyenne || 0), 0) / (moyennes.filter(m => m.moyenne != null).length || 1)
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <Entete titre="Moyennes" retour />

      {/* Sélecteur classe */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filtresScroll}>
        {classes.map(c => (
          <TouchableOpacity key={c.classe_id}
            style={[styles.filtreBtn, classeActif === c.classe && styles.filtreBtnActif]}
            onPress={() => setClasseActif(c.classe)}>
            <Text style={[styles.filtreLabel, classeActif === c.classe && styles.filtreLabelActif]}>{c.classe}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Sélecteur matière */}
      {matieres.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.matieresScroll}>
          {matieres.map(m => (
            <TouchableOpacity key={m}
              style={[styles.matiereBtn, matiereActif === m && styles.matiereBtnActif]}
              onPress={() => setMatiereActif(m)}>
              <Text style={[styles.matiereLabel, matiereActif === m && styles.matiereLabelActif]} numberOfLines={1}>{m}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Résumé classe */}
      {moyenneClasse !== null && (
        <View style={styles.resumeBar}>
          <View style={[styles.resumeItem, { backgroundColor: Colors.primaryBg }]}>
            <Text style={[styles.resumeNum, { color: Colors.primary }]}>{moyennes.length}</Text>
            <Text style={styles.resumeLbl}>Élèves</Text>
          </View>
          <View style={[styles.resumeItem, { backgroundColor: (couleurNote(moyenneClasse) + '20') }]}>
            <Text style={[styles.resumeNum, { color: couleurNote(moyenneClasse) }]}>{moyenneClasse.toFixed(2)}</Text>
            <Text style={styles.resumeLbl}>Moy. classe</Text>
          </View>
          <View style={[styles.resumeItem, { backgroundColor: Colors.successLight }]}>
            <Text style={[styles.resumeNum, { color: Colors.success }]}>{moyennes.filter(m => (m.moyenne || 0) >= 10).length}</Text>
            <Text style={styles.resumeLbl}>≥ 10/20</Text>
          </View>
          <View style={[styles.resumeItem, { backgroundColor: Colors.dangerLight }]}>
            <Text style={[styles.resumeNum, { color: Colors.danger }]}>{moyennes.filter(m => m.moyenne != null && m.moyenne < 10).length}</Text>
            <Text style={styles.resumeLbl}>{'< 10/20'}</Text>
          </View>
        </View>
      )}

      <FlatList
        data={moyennes}
        keyExtractor={m => m.eleve_id}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>Aucune donnée · Saisissez et publiez des notes d'abord</Text>}
        renderItem={({ item: m, index }) => (
          <View style={[styles.ligne, Shadow.sm, index === 0 && styles.premiereLigne]}>
            <View style={styles.rang}>
              {index < 3
                ? <Ionicons name="trophy" size={18} color={['#FFD700','#C0C0C0','#CD7F32'][index]} />
                : <Text style={styles.rangNum}>{index + 1}</Text>
              }
            </View>
            <View style={styles.eleveInfo}>
              <Text style={styles.eleveNom}>{m.prenom} {m.nom}</Text>
              <Text style={styles.nbNotes}>{m.nb_notes} note{m.nb_notes > 1 ? 's' : ''}</Text>
            </View>
            <NoteBulle note={m.moyenne} taille="sm" />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.background },
  filtresScroll: { paddingHorizontal: Spacing.md, paddingVertical: 8, maxHeight: 46 },
  filtreBtn:     { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.full, marginRight: 8, borderWidth: 1.5, borderColor: Colors.gray200, backgroundColor: Colors.white },
  filtreBtnActif: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  filtreLabel:   { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  filtreLabelActif: { color: Colors.primary },
  matieresScroll: { paddingHorizontal: Spacing.md, marginBottom: 6, maxHeight: 42 },
  matiereBtn:    { paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radius.full, marginRight: 8, backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.gray200 },
  matiereBtnActif: { backgroundColor: Colors.accent + '20', borderColor: Colors.accent },
  matiereLabel:  { fontSize: Typography.xs, color: Colors.gray500 },
  matiereLabelActif: { color: Colors.accent, fontWeight: Typography.semibold },
  resumeBar:     { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm, gap: 6 },
  resumeItem:    { flex: 1, borderRadius: Radius.sm, paddingVertical: 8, alignItems: 'center' },
  resumeNum:     { fontSize: Typography.lg, fontWeight: Typography.bold },
  resumeLbl:     { fontSize: Typography.xs, color: Colors.gray500, marginTop: 1, textAlign: 'center' },
  liste:         { paddingHorizontal: Spacing.md, paddingBottom: 40 },
  ligne:         { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.md, paddingVertical: 12, paddingHorizontal: Spacing.md, marginBottom: 6, gap: 12 },
  premiereLigne: { borderWidth: 1.5, borderColor: Colors.primary + '30' },
  rang:          { width: 30, alignItems: 'center' },
  rangNum:       { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.gray500 },
  eleveInfo:     { flex: 1 },
  eleveNom:      { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.gray900 },
  nbNotes:       { fontSize: Typography.xs, color: Colors.gray400, marginTop: 2 },
  empty:         { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm, paddingHorizontal: Spacing.xl, lineHeight: 22 },
});
