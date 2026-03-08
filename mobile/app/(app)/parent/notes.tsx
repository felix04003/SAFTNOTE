// app/(app)/parent/notes.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, SectionList, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import NoteBulle from '../../../src/components/ui/NoteBulle';

export default function NotesParentScreen() {
  const { eleve_id } = useLocalSearchParams<{ eleve_id: string }>();
  const [sections, setSections] = useState<any[]>([]);

  useEffect(() => {
    getDB().getAllAsync(
      'SELECT * FROM notes_parent WHERE eleve_id=? ORDER BY matiere, date_evaluation DESC', [eleve_id]
    ).then((rows: any[]) => {
      // Grouper par matière
      const map: Record<string, any[]> = {};
      rows.forEach(n => { if (!map[n.matiere]) map[n.matiere] = []; map[n.matiere].push(n); });
      setSections(Object.entries(map).map(([matiere, data]) => ({
        title: matiere,
        moyenne: data.filter(n => n.valeur != null).reduce((s, n) => s + n.valeur, 0) / (data.filter(n => n.valeur != null).length || 1),
        data,
      })));
    });
  }, [eleve_id]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre="Notes" retour />
      <SectionList
        sections={sections}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitre}>{section.title}</Text>
            <View style={[styles.moyBulle, { backgroundColor: couleurNote(section.moyenne) + '20' }]}>
              <Text style={[styles.moyTxt, { color: couleurNote(section.moyenne) }]}>{section.moyenne?.toFixed(2)}/20</Text>
            </View>
          </View>
        )}
        renderItem={({ item: n }) => (
          <View style={[styles.noteRow, Shadow.sm]}>
            <NoteBulle note={n.valeur} taille="sm" />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.noteType}>{n.type_eval === 'composition' ? 'Composition' : n.type_eval === 'devoir' ? 'Devoir' : n.type_eval}</Text>
              {n.date_evaluation && <Text style={styles.noteDate}>
                {new Date(n.date_evaluation).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}
              </Text>}
            </View>
            <Text style={styles.trimestre}>T{n.trimestre}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.empty}>Aucune note disponible</Text>}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: Colors.background },
  liste: { paddingHorizontal: Spacing.md, paddingBottom: 80 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.gray50, paddingVertical: 10, paddingHorizontal: Spacing.md, marginHorizontal: -Spacing.md, borderTopWidth: 1, borderTopColor: Colors.gray100, borderBottomWidth: 1, borderBottomColor: Colors.gray100 },
  sectionTitre:  { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.gray800 },
  moyBulle: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.full },
  moyTxt:   { fontSize: Typography.xs, fontWeight: Typography.bold },
  noteRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.sm, marginVertical: 3 },
  noteType: { fontSize: Typography.sm, fontWeight: Typography.medium, color: Colors.gray800 },
  noteDate: { fontSize: Typography.xs, color: Colors.gray500, marginTop: 2 },
  trimestre:{ fontSize: Typography.xs, color: Colors.gray400, fontWeight: Typography.medium },
  empty:    { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm },
});
