// src/components/ui/Badge.tsx
import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Typography } from '../../utils/theme';

type Variant = 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'neutral';

interface Props {
  label: string;
  variant?: Variant;
  style?: ViewStyle;
  taille?: 'sm' | 'md';
}

const COULEURS: Record<Variant, { bg: string; text: string; border: string }> = {
  success:  { bg: Colors.successLight, text: Colors.success,  border: Colors.success  },
  danger:   { bg: Colors.dangerLight,  text: Colors.danger,   border: Colors.danger   },
  warning:  { bg: Colors.warningLight, text: Colors.warning,  border: Colors.warning  },
  info:     { bg: Colors.infoLight,    text: Colors.info,     border: Colors.info     },
  primary:  { bg: Colors.primaryBg,    text: Colors.primary,  border: Colors.primary  },
  neutral:  { bg: Colors.gray100,      text: Colors.gray500,  border: Colors.gray300  },
};

export const VARIANT_PRESENCE: Record<string, Variant> = {
  present:     'success',
  absent:      'danger',
  retard:      'warning',
  sorti_avant: 'warning',
  dispense:    'info',
  non_saisi:   'neutral',
};

export const VARIANT_MENTION: Record<string, Variant> = {
  tres_bien:   'success',
  bien:        'primary',
  assez_bien:  'info',
  passable:    'neutral',
  insuffisant: 'warning',
  tres_insuffisant: 'danger',
};

export const LABEL_PRESENCE: Record<string, string> = {
  present:     'Présent',
  absent:      'Absent',
  retard:      'En retard',
  sorti_avant: 'Sorti tôt',
  dispense:    'Dispensé',
  non_saisi:   '—',
};

export default function Badge({ label, variant = 'neutral', style, taille = 'sm' }: Props) {
  const c = COULEURS[variant];
  const padding = taille === 'sm' ? { paddingHorizontal: 8, paddingVertical: 3 } : { paddingHorizontal: 12, paddingVertical: 6 };

  return (
    <View style={[
      styles.badge,
      { backgroundColor: c.bg, borderColor: c.border },
      padding,
      style,
    ]}>
      <Text style={[styles.label, { color: c.text, fontSize: taille === 'sm' ? Typography.xs : Typography.sm }]}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: Radius.full,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  label: {
    fontWeight: Typography.semibold,
  },
});
