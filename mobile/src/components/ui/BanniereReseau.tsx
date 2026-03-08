// src/components/ui/BanniereReseau.tsx
import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '../../hooks/useSync';
import { Colors, Typography, Spacing } from '../../utils/theme';

export default function BanniereReseau() {
  const { connecte, enSync } = useSync();
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: (!connecte || enSync) ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
    }).start();
  }, [connecte, enSync]);

  if (connecte && !enSync) return null;

  return (
    <Animated.View style={[styles.banniere, { backgroundColor: connecte ? Colors.primary : Colors.warning }, { opacity: anim }]}>
      <Ionicons name={connecte ? 'sync-outline' : 'cloud-offline-outline'} size={14} color={Colors.white} />
      <Text style={styles.txt}>
        {connecte ? 'Synchronisation en cours…' : 'Mode hors ligne — modifications enregistrées localement'}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banniere: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: Spacing.md },
  txt:      { fontSize: Typography.xs, color: Colors.white, fontWeight: Typography.medium },
});
