// src/components/ui/Carte.tsx
import React from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Shadow, Spacing } from '../../utils/theme';

interface Props {
  children: React.ReactNode;
  style?: ViewStyle;
  padding?: number;
  elevation?: 'sm' | 'md' | 'none';
}

export default function Carte({ children, style, padding = Spacing.md, elevation = 'sm' }: Props) {
  return (
    <View style={[
      styles.carte,
      elevation !== 'none' && Shadow[elevation],
      { padding },
      style,
    ]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  carte: {
    backgroundColor: Colors.white,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
});
