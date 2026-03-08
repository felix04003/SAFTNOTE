// src/components/ui/StatCard.tsx
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, Typography } from '../../utils/theme';

interface Props {
  titre:     string;
  valeur:    string | number;
  icone:     keyof typeof Ionicons.glyphMap;
  couleur?:  string;
  sousTitre?: string;
  onPress?:  () => void;
}

export default function StatCard({ titre, valeur, icone, couleur = Colors.primary, sousTitre, onPress }: Props) {
  const Wrapper: any = onPress ? TouchableOpacity : View;

  return (
    <Wrapper onPress={onPress} activeOpacity={0.85} style={[styles.card, Shadow.sm]}>
      <View style={[styles.iconeContainer, { backgroundColor: couleur + '18' }]}>
        <Ionicons name={icone} size={22} color={couleur} />
      </View>
      <Text style={styles.valeur}>{valeur}</Text>
      <Text style={styles.titre} numberOfLines={1}>{titre}</Text>
      {sousTitre && <Text style={styles.sous} numberOfLines={1}>{sousTitre}</Text>}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    padding: Spacing.md,
    flex: 1,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  iconeContainer: {
    width: 44, height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  valeur: {
    fontSize: Typography.xl,
    fontWeight: Typography.bold,
    color: Colors.gray900,
    marginBottom: 2,
  },
  titre: {
    fontSize: Typography.xs,
    color: Colors.gray500,
    textAlign: 'center',
    fontWeight: Typography.medium,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  sous: {
    fontSize: Typography.xs - 1,
    color: Colors.accent,
    marginTop: 2,
  },
});
