// src/components/ui/EmptyState.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../../utils/theme';

interface Props {
  icone:      string;
  titre:      string;
  sousTitre?: string;
  action?:    { label: string; onPress: () => void };
}

export default function EmptyState({ icone, titre, sousTitre, action }: Props) {
  return (
    <View style={s.container}>
      <View style={s.ico}>
        <Ionicons name={icone as any} size={36} color={Colors.gray300} />
      </View>
      <Text style={s.titre}>{titre}</Text>
      {sousTitre && <Text style={s.sous}>{sousTitre}</Text>}
      {action && (
        <TouchableOpacity onPress={action.onPress} style={s.btn}>
          <Text style={s.btnLbl}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: Spacing.xl, paddingHorizontal: Spacing.lg, gap: 8 },
  ico:       { width: 68, height: 68, borderRadius: 34, backgroundColor: Colors.gray100,
               alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  titre:     { fontSize: Typography.base, fontWeight: '600', color: Colors.gray600, textAlign: 'center' },
  sous:      { fontSize: Typography.sm, color: Colors.gray400, textAlign: 'center', lineHeight: 20 },
  btn:       { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8,
               backgroundColor: Colors.accent + '15', borderRadius: Radius.full },
  btnLbl:    { fontSize: Typography.sm, color: Colors.accent, fontWeight: '600' },
});
