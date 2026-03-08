// src/components/ui/Bouton.tsx
import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { Colors, Radius, Typography, Shadow } from '../../utils/theme';

type Variante = 'primaire' | 'secondaire' | 'danger' | 'fantome';

interface Props {
  label: string;
  onPress: () => void;
  variante?: Variante;
  chargement?: boolean;
  desactive?: boolean;
  style?: ViewStyle;
  pleineLargeur?: boolean;
}

const CONFIG: Record<Variante, { bg: string; text: string; border?: string }> = {
  primaire:   { bg: Colors.primary,   text: Colors.white },
  secondaire: { bg: Colors.accent,    text: Colors.white },
  danger:     { bg: Colors.danger,    text: Colors.white },
  fantome:    { bg: 'transparent',    text: Colors.primary, border: Colors.primary },
};

export default function Bouton({
  label, onPress, variante = 'primaire', chargement = false,
  desactive = false, style, pleineLargeur = false,
}: Props) {
  const c = CONFIG[variante];

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={desactive || chargement}
      style={[
        styles.bouton,
        { backgroundColor: c.bg, ...(c.border ? { borderColor: c.border, borderWidth: 2 } : {}) },
        pleineLargeur && styles.pleineLargeur,
        (desactive || chargement) && styles.desactive,
        Shadow.sm,
        style,
      ]}
    >
      {chargement
        ? <ActivityIndicator color={c.text} size="small" />
        : <Text style={[styles.label, { color: c.text }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bouton: {
    height: 48,
    borderRadius: Radius.md,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pleineLargeur: { width: '100%' },
  desactive:     { opacity: 0.5 },
  label: {
    fontSize: Typography.base,
    fontWeight: Typography.semibold,
    letterSpacing: 0.3,
  },
});
