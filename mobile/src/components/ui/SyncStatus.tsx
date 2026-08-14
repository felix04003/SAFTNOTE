// src/components/ui/SyncStatus.tsx
// Bandeau d'état de synchronisation — visible sur les dashboards
import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Spacing, Radius } from '../../utils/theme';

export type StatutSync = 'ok' | 'en_attente' | 'erreur' | 'hors_ligne';

interface Props {
  statut:       StatutSync;
  nbEnAttente?: number;
  onPresser?:   () => void;
}

export default function SyncStatus({ statut, nbEnAttente = 0, onPresser }: Props) {
  if (statut === 'ok' && nbEnAttente === 0) return null;

  const config = {
    ok:         { bg: Colors.successLight, color: Colors.success, icone: 'checkmark-circle' as const },
    en_attente: { bg: Colors.warningLight, color: Colors.warning, icone: 'cloud-upload-outline' as const },
    erreur:     { bg: Colors.dangerLight,  color: Colors.danger,  icone: 'alert-circle-outline' as const },
    hors_ligne: { bg: Colors.gray100,      color: Colors.gray500, icone: 'cloud-offline-outline' as const },
  }[statut];

  const message = {
    ok:         'Synchronisé',
    en_attente: `${nbEnAttente} élément${nbEnAttente > 1 ? 's' : ''} en attente`,
    erreur:     'Sync échouée — Appuyer pour réessayer',
    hors_ligne: 'Hors ligne — données locales',
  }[statut];

  return (
    <TouchableOpacity
      style={[styles.bandeau, { backgroundColor: config.bg }]}
      onPress={onPresser}
      activeOpacity={onPresser ? 0.7 : 1}
      accessibilityLabel={message}
    >
      <Ionicons name={config.icone} size={14} color={config.color} />
      <Text style={[styles.texte, { color: config.color }]}>{message}</Text>
      {onPresser && statut !== 'hors_ligne' && (
        <Ionicons name="refresh-outline" size={14} color={config.color} style={{ marginLeft: 4 }} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bandeau: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.sm,
    marginHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
  },
  texte: { fontSize: Typography.xs, fontWeight: '500' },
});
