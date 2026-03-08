// app/(app)/parent/bulletins.tsx
import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Linking, Alert } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing, Radius, Shadow, couleurNote } from '../../../src/utils/theme';
import Entete from '../../../src/components/ui/Entete';
import NoteBulle from '../../../src/components/ui/NoteBulle';
import Badge from '../../../src/components/ui/Badge';
import { VARIANT_MENTION } from '../../../src/components/ui/Badge';

const LABELS_MENTION: Record<string, string> = {
  tres_bien: 'Très bien', bien: 'Bien', assez_bien: 'Assez bien',
  passable: 'Passable', insuffisant: 'Insuffisant', tres_insuffisant: 'Très insuffisant',
};

export default function BulletinsScreen() {
  const { eleve_id } = useLocalSearchParams<{ eleve_id: string }>();
  const [bulletins, setBulletins] = useState<any[]>([]);

  useEffect(() => {
    getDB().getAllAsync('SELECT * FROM bulletins WHERE eleve_id=? ORDER BY trimestre DESC', [eleve_id])
      .then(rows => setBulletins(rows as any[]));
  }, [eleve_id]);

  async function ouvrirBulletin(url: string) {
    if (!url) return Alert.alert('Bulletin non disponible', 'Le bulletin n\'est pas encore téléchargeable.');
    try { await Linking.openURL(url); }
    catch { Alert.alert('Erreur', 'Impossible d\'ouvrir le bulletin.'); }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Entete titre="Bulletins" retour />
      <FlatList
        data={bulletins}
        keyExtractor={(_, i) => String(i)}
        contentContainerStyle={styles.liste}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={<Text style={styles.empty}>Aucun bulletin disponible</Text>}
        renderItem={({ item: b }) => (
          <View style={[styles.card, Shadow.md]}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.trimestreTxt}>Trimestre {b.trimestre}</Text>
                {b.mention && (
                  <Badge label={LABELS_MENTION[b.mention] || b.mention}
                    variant={VARIANT_MENTION[b.mention] || 'neutral'} taille="md" style={{ marginTop: 6 }} />
                )}
              </View>
              <NoteBulle note={b.moyenne_generale} taille="lg" />
            </View>
            <View style={styles.separator} />
            <View style={styles.infoRow}>
              <View style={styles.infoItem}>
                <Ionicons name="trophy-outline" size={16} color={Colors.accent} />
                <Text style={styles.infoLabel}>Rang</Text>
                <Text style={styles.infoValeur}>{b.rang || '—'}<Text style={styles.infoSur}>/{b.rang_sur}</Text></Text>
              </View>
            </View>
            <TouchableOpacity
              style={[styles.btnTelecharger, !b.bulletin_url && styles.btnDesactive]}
              onPress={() => ouvrirBulletin(b.bulletin_url)}
              activeOpacity={0.8}
            >
              <Ionicons name={b.bulletin_url ? 'download-outline' : 'time-outline'} size={18} color={Colors.white} />
              <Text style={styles.btnLabel}>{b.bulletin_url ? 'Télécharger le bulletin PDF' : 'Bulletin en cours de génération'}</Text>
            </TouchableOpacity>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe:  { flex: 1, backgroundColor: Colors.background },
  liste: { paddingHorizontal: Spacing.md, paddingTop: Spacing.sm, paddingBottom: 80 },
  card:  { backgroundColor: Colors.white, borderRadius: Radius.lg, padding: Spacing.lg, marginBottom: Spacing.md },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Spacing.md },
  trimestreTxt: { fontSize: Typography.lg, fontWeight: Typography.bold, color: Colors.gray900 },
  separator: { height: 1, backgroundColor: Colors.gray100, marginBottom: Spacing.md },
  infoRow:   { flexDirection: 'row', marginBottom: Spacing.md },
  infoItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
  infoLabel: { fontSize: Typography.xs, color: Colors.gray500 },
  infoValeur:{ fontSize: Typography.base, fontWeight: Typography.bold, color: Colors.gray900 },
  infoSur:   { fontSize: Typography.xs, color: Colors.gray400, fontWeight: Typography.regular },
  btnTelecharger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: Radius.md, height: 48 },
  btnDesactive: { backgroundColor: Colors.gray400 },
  btnLabel:  { fontSize: Typography.sm, fontWeight: Typography.bold, color: Colors.white },
  empty:     { textAlign: 'center', color: Colors.gray400, marginTop: Spacing.xl, fontSize: Typography.sm },
});
