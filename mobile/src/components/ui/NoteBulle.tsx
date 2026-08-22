// src/components/ui/NoteBulle.tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { couleurNote, Colors, Typography, Radius } from '../../utils/theme';

interface Props {
  note: number | null;
  max?: number;
  taille?: 'sm' | 'md' | 'lg';
}

const TAILLES = {
  sm: { bulle: 36, texte: 13, sous: 11 },
  md: { bulle: 52, texte: 18, sous: 11 },
  lg: { bulle: 70, texte: 24, sous: 13 },
};

export default function NoteBulle({ note, max = 20, taille = 'md' }: Props) {
  const couleur = couleurNote(note);
  const dim = TAILLES[taille];

  return (
    <View style={[
      styles.bulle,
      {
        width: dim.bulle, height: dim.bulle,
        borderRadius: dim.bulle / 2,
        backgroundColor: couleur + '20',
        borderColor: couleur,
      }
    ]}>
      <Text style={[styles.note, { fontSize: dim.texte, color: couleur }]}>
        {note !== null ? note.toFixed(1).replace('.0', '') : '—'}
      </Text>
      <Text style={[styles.max, { fontSize: dim.sous, color: couleur + 'CC' }]}>
        /{max}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bulle: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  note: {
    fontWeight: Typography.bold,
    lineHeight: undefined,
  },
  max: {
    fontWeight: Typography.medium,
    marginTop: -2,
  },
});
