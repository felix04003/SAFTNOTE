// src/components/ui/Entete.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Typography, Spacing } from '../../utils/theme';

interface Props {
  titre: string;
  sousTitre?: string;
  retour?: boolean;
  droite?: React.ReactNode;
  couleurFond?: string;
}

export default function Entete({ titre, sousTitre, retour = false, droite, couleurFond = Colors.primary }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.entete, { backgroundColor: couleurFond, paddingTop: insets.top + 8 }]}>
      <StatusBar barStyle="light-content" backgroundColor={couleurFond} />
      <View style={styles.ligne}>
        {retour && (
          <TouchableOpacity onPress={() => router.back()} style={styles.retourBtn} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="chevron-back" size={24} color={Colors.white} />
          </TouchableOpacity>
        )}
        <View style={styles.textes}>
          <Text style={styles.titre} numberOfLines={1}>{titre}</Text>
          {sousTitre && <Text style={styles.sous} numberOfLines={1}>{sousTitre}</Text>}
        </View>
        {droite && <View style={styles.droite}>{droite}</View>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  entete: {
    paddingHorizontal: Spacing.md,
    paddingBottom: Spacing.md,
  },
  ligne: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  retourBtn: {
    marginRight: 8,
    padding: 4,
  },
  textes: { flex: 1 },
  titre: {
    fontSize: Typography.lg,
    fontWeight: Typography.bold,
    color: Colors.white,
  },
  sous: {
    fontSize: Typography.sm,
    color: Colors.white + 'CC',
    marginTop: 2,
  },
  droite: { marginLeft: 8 },
});
