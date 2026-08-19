// app/(app)/parent/absences.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import Badge from '../../../src/components/ui/Badge';

export default function AbsencesScreen() {
  const { eleve_id } = useLocalSearchParams<{ eleve_id: string }>();
  const [absences, setAbsences] = useState<any[]>([]);
  const [filtre,   setFiltre]   = useState<'toutes' | 'injustifiees'>('toutes');

  useEffect(() => {
    getDB().getAllAsync(
      'SELECT * FROM absences WHERE eleve_id=? ORDER BY date_cours DESC', [eleve_id]
    ).then(rows => setAbsences(rows as any[]));
  }, [eleve_id]);

  const filtrees = filtre === 'injustifiees' ? absences.filter(a => !a.est_justifie) : absences;
  const nbInjust = absences.filter(a => !a.est_justifie).length;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre="Absences" retour />
      <View style={styles.resume}>
        <View style={[styles.resumeItem, { backgroundColor: Colors.dangerLight }]}>
          <Text style={[styles.resumeNum, { color: Colors.danger }]}>{nbInjust}</Text>
          <Text style={styles.resumeLbl}>Non justifiées</Text>
        </View>
        <View style={[styles.resumeItem, { backgroundColor: Colors.successLight }]}>
          <Text style={[styles.resumeNum, { color: Colors.success }]}>{absences.length - nbInjust}</Text>
          <Text style={styles.resumeLbl}>Justifiées</Text>
        </View>
        <View style={[styles.resumeItem, { backgroundColor: Colors.gray100 }]}>
          <Text style={[styles.resumeNum, { color: Colors.gray700 }]}>{absences.length}</Text>
          <Text style={styles.resumeLbl}>Total</Text>
        </View>
      </View>
      <View style={styles.filtres}>
        {(['toutes', 'injustifiees'] as const).map(f => (
          <TouchableOpacity key={f} style={[styles.filtreBtn, filtre === f && styles.filtreBtnActif]} onPress={() => setFiltre(f)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={[styles.filtreLabel, filtre === f && styles.filtreLabelActif]}>
              {f === 'toutes' ? 'Toutes' : 'Non justifiées'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <FlatList
        data={filtrees}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>Aucune absence{filtre === 'injustifiees' ? ' non justifiée' : ''}</Text>}
        renderItem={({ item: a }) => (
          <View style={[styles.card, Shadow.sm]}>
            <View style={[styles.statut, { backgroundColor: a.est_justifie ? Colors.successLight : Colors.dangerLight }]}>
              <Ionicons name={a.est_justifie ? 'checkmark-circle' : 'close-circle'} size={22} color={a.est_justifie ? Colors.success : Colors.danger} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.matiere}>{a.matiere || 'Matière non renseignée'}</Text>
              <Text style={styles.date}>
                {new Date(a.date_cours).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
              </Text>
              {a.justification && <Text style={styles.justif}>Motif : {a.justification}</Text>}
            </View>
            <Badge label={a.est_justifie ? 'Justifiée' : 'Non justifiée'} variant={a.est_justifie ? 'success' : 'danger'} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: Colors.background },
  resume: { flexDirection: 'row', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm, gap: 8 },
  resumeItem: { flex: 1, borderRadius: Radius.sm, padding: Spacing.sm, alignItems: 'center' },
  resumeNum: { fontSize: Typography.xl, fontWeight: Typography.bold },
  resumeLbl: { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2, textAlign: 'center' },
  filtres:   { flexDirection: 'row', paddingHorizontal: Spacing.md, marginBottom: Spacing.sm, gap: 8 },
  filtreBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.full, borderWidth: 1.5, borderColor: Colors.gray200, backgroundColor: Colors.white },
  filtreBtnActif: { borderColor: Colors.primary, backgroundColor: Colors.primaryBg },
  filtreLabel:    { fontSize: Typography.xs, color: Colors.gray500, fontWeight: Typography.medium },
  filtreLabelActif: { color: Colors.primary },
  liste: { paddingHorizontal: Spacing.md, paddingBottom: 80 },
  card:  { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.sm, marginBottom: 8, gap: 12 },
  statut: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  matiere: { fontSize: Typography.sm, fontWeight: Typography.semibold, color: Colors.gray900 },
  date:    { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2 },
  justif:  { fontSize: Typography.xs, color: Colors.gray400, marginTop: 2, fontStyle: 'italic' },
  empty:   { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm },
});
