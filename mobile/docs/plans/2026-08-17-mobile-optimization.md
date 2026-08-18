# EcoleManager Mobile — Plan d'optimisation

> **Pour l'execution :** Utiliser superpowers:executing-plans pour implementer ce plan.

**Objectif :** 5 bugs critiques + 6 ameliorations UX/design
**Stack :** React Native 0.76 / Expo SDK 52 / SQLite offline-first / Zustand
**Total estime CC :** ~6h30

---

## Chunk 1 : Bugs P0/P1

### T1 : ID collision notes-saisie.tsx:72

**Fichiers :** Modifier `app/(app)/enseignant/notes-saisie.tsx`

- [ ] Installer expo-crypto si absent : `npx expo install expo-crypto`
- [ ] Ajouter import : `import * as Crypto from 'expo-crypto';`
- [ ] Ligne 72 — remplacer :
  ```
  // AVANT
  id: Date.now().toString() + n.eleve_id,
  // APRES
  id: Crypto.randomUUID(),
  ```

### T2 : DELETE trop large appel.tsx:104

**Fichiers :** Modifier `app/(app)/enseignant/appel.tsx`

- [ ] Ligne 104 — remplacer :
  ```typescript
  // AVANT
  await db.runAsync("DELETE FROM operations_pending WHERE type='presences.saisir'");
  // APRES
  await db.runAsync(
    `DELETE FROM operations_pending WHERE type='presences.saisir' AND payload LIKE ?`,
    [`%"appel_id":"${appelId}"%`]
  );
  ```

### T3 : JSON.parse non protege syncService.ts:93

**Fichiers :** Modifier `src/services/sync/syncService.ts`

- [ ] Lignes 93-101 — remplacer le `.map()` par :
  ```typescript
  const ops = batch.flatMap(op => {
    try {
      return [{ id: op.id, type: op.type, payload: JSON.parse(op.payload), cree_at_local: op.created_at_local }];
    } catch {
      console.warn('[Sync] Payload corrompu ignore', op.id);
      return [];
    }
  });
  if (ops.length === 0) continue;
  ```
- [ ] Apres la boucle des resultats, ajouter dead-letter :
  ```typescript
  await db.runAsync(
    `UPDATE operations_pending SET statut='dead_letter' WHERE tentatives >= 5 AND statut != 'ok'`
  );
  ```

### T4 : Selecteur pays OTP connexion.tsx:50

**Fichiers :** Modifier `app/auth/connexion.tsx`

- [ ] Ajouter constante en haut du fichier :
  ```typescript
  const PAYS = [
    { code: 'SN', label: 'Senegal',       prefixe: '+221' },
    { code: 'CI', label: "Cote d'Ivoire", prefixe: '+225' },
    { code: 'ML', label: 'Mali',           prefixe: '+223' },
    { code: 'BF', label: 'Burkina Faso',  prefixe: '+226' },
    { code: 'GN', label: 'Guinee',         prefixe: '+224' },
    { code: 'CM', label: 'Cameroun',       prefixe: '+237' },
  ] as const;
  ```
- [ ] Ajouter state : `const [pays, setPays] = useState(PAYS[0]);`
- [ ] Remplacer `<Text style={styles.prefixe}>+221</Text>` par :
  ```tsx
  <TouchableOpacity style={styles.paysSelector} onPress={() => {
    const idx = PAYS.findIndex(p => p.code === pays.code);
    setPays(PAYS[(idx + 1) % PAYS.length]);
  }}>
    <Text style={styles.prefixe}>{pays.prefixe}</Text>
    <Ionicons name="chevron-down" size={12} color={Colors.gray500} />
  </TouchableOpacity>
  ```
- [ ] Remplacer les 2 occurrences de `'+221' + telephone` par `pays.prefixe + telephone`
- [ ] Ajouter style : `paysSelector: { flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },`

### T5 : JWT persiste avec expo-secure-store

**Fichiers :** Modifier `src/stores/authStore.ts`, `app/_layout.tsx`

- [ ] Installer : `npx expo install expo-secure-store`
- [ ] Dans authStore.ts, ajouter imports :
  ```typescript
  import * as SecureStore from 'expo-secure-store';
  const TOKEN_KEY = 'ecolemanager_jwt';
  ```
- [ ] Dans connexionMDP, apres set({ session }), ajouter : `await SecureStore.setItemAsync(TOKEN_KEY, res.token);`
- [ ] Dans deconnexion, ajouter : `await SecureStore.deleteItemAsync(TOKEN_KEY);`
- [ ] Ajouter action restaurerSession au store :
  ```typescript
  restaurerSession: async () => {
    try {
      const token = await SecureStore.getItemAsync(TOKEN_KEY);
      if (!token) return;
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) { await SecureStore.deleteItemAsync(TOKEN_KEY); return; }
      const db = getDB();
      const row = await db.getFirstAsync<any>('SELECT * FROM session LIMIT 1');
      if (row) set({ session: { ...row, token } });
    } catch { /* session expiree */ }
  },
  ```
- [ ] Dans app/_layout.tsx, apres ouvrirBD() :
  ```typescript
  const { restaurerSession } = useAuthStore.getState();
  await restaurerSession();
  ```

---

## Chunk 2 : Bottom Tab Bar

### T6 : Tabs enseignant + parent

**Fichiers :** Modifier `app/(app)/enseignant/_layout.tsx`, `app/(app)/parent/_layout.tsx`

- [ ] enseignant/_layout.tsx — remplacer Stack par Tabs :
  ```typescript
  import { Tabs } from 'expo-router';
  // ...
  export default function LayoutEnseignant() {
    return (
      <Tabs screenOptions={{
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.gray400,
        tabBarStyle: { backgroundColor: Colors.white, borderTopColor: Colors.gray200, height: 60, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        headerShown: false,
      }}>
        <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="appel" options={{ title: 'Appel', tabBarIcon: ({ color, size }) => <Ionicons name="checkmark-circle-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="notes-saisie" options={{ title: 'Notes', tabBarIcon: ({ color, size }) => <Ionicons name="create-outline" size={size} color={color} /> }} />
        <Tabs.Screen name="evaluations" options={{ href: null }} />
        <Tabs.Screen name="moyennes" options={{ href: null }} />
        <Tabs.Screen name="classes" options={{ href: null }} />
        <Tabs.Screen name="bulletins" options={{ href: null }} />
      </Tabs>
    );
  }
  ```
- [ ] parent/_layout.tsx — meme pattern, 4 tabs : index / absences / notes / bulletins

---

## Chunk 3 : Animations

### T7 : StatCard slide-in + haptic feedback

**Fichiers :** Modifier `src/components/ui/StatCard.tsx`, `app/(app)/enseignant/appel.tsx`

- [ ] Verifier/installer : `npx expo install react-native-reanimated expo-haptics`
- [ ] Dans StatCard.tsx, ajouter animation slide-in :
  ```typescript
  import Animated, { useAnimatedStyle, useSharedValue, withSpring, withDelay } from 'react-native-reanimated';
  // Props : ajouter index?: number
  const translateY = useSharedValue(30);
  const opacity = useSharedValue(0);
  useEffect(() => {
    translateY.value = withDelay((index || 0) * 120, withSpring(0, { damping: 14 }));
    opacity.value = withDelay((index || 0) * 120, withSpring(1));
  }, []);
  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }], opacity: opacity.value }));
  // Wrapper le return dans <Animated.View style={[styles.container, animStyle]}>
  ```
- [ ] Dans les dashboards enseignant + parent, passer `index={0}` et `index={1}` aux StatCards
- [ ] Dans appel.tsx, apres changerStatut() :
  ```typescript
  import * as Haptics from 'expo-haptics';
  // Dans changerStatut() :
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  ```

---

## Chunk 4 : EmptyState

### T8 : Composant EmptyState + integrations

**Fichiers :** Creer `src/components/ui/EmptyState.tsx`, modifier 3 ecrans

- [ ] **Creer EmptyState.tsx** (importeurs : enseignant/index, appel, parent/index)
  ```typescript
  import React from 'react';
  import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
  import { Ionicons } from '@expo/vector-icons';
  import { Colors, Typography, Spacing, Radius } from '../../utils/theme';

  interface Props {
    icone: string; titre: string; sousTitre?: string;
    action?: { label: string; onPress: () => void };
  }

  export default function EmptyState({ icone, titre, sousTitre, action }: Props) {
    return (
      <View style={s.container}>
        <View style={s.ico}><Ionicons name={icone as any} size={36} color={Colors.gray300} /></View>
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
    container: { alignItems: 'center', paddingVertical: Spacing.xl, gap: 8, paddingHorizontal: Spacing.lg },
    ico:  { width: 68, height: 68, borderRadius: 34, backgroundColor: Colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    titre:{ fontSize: Typography.base, fontWeight: '600', color: Colors.gray600, textAlign: 'center' },
    sous: { fontSize: Typography.sm, color: Colors.gray400, textAlign: 'center', lineHeight: 20 },
    btn:  { marginTop: 8, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: Colors.accent + '15', borderRadius: Radius.full },
    btnLbl: { fontSize: Typography.sm, color: Colors.accent, fontWeight: '600' },
  });
  ```

- [ ] Dans enseignant/index.tsx — remplacer le text "Aucun cours" :
  ```typescript
  import EmptyState from '../../../src/components/ui/EmptyState';
  // ...
  <EmptyState
    icone="calendar-outline"
    titre={`Pas de cours ce ${JOURS[jourActif]}`}
    sousTitre="Journee libre ou emploi du temps non charge"
  />
  ```

- [ ] Dans appel.tsx — remplacer ListEmptyComponent :
  ```typescript
  ListEmptyComponent={
    <EmptyState
      icone="people-outline"
      titre="Aucun eleve dans cette classe"
      sousTitre="Tirez vers le bas pour synchroniser les donnees"
      action={{ label: "Actualiser", onPress: initialiserAppel }}
    />
  }
  ```

---

## Chunk 5 : Dashboard Vivant

### T9 : Sparklines + jauge bulletins

**Fichiers :** Modifier `app/(app)/enseignant/index.tsx`

- [ ] Etendre le type stats :
  ```typescript
  const [stats, setStats] = useState({
    nb_classes: 0, nb_evaluations: 0, notes_en_attente: 0,
    sparkPresences: [] as number[],
    pctBulletins: 0,
  });
  ```
- [ ] Dans charger(), apres les existants Promise.all, ajouter :
  ```typescript
  const presences7j: any[] = await db.getAllAsync(`
    SELECT date_cours,
      SUM(CASE WHEN statut IN ('absent','retard') THEN 1 ELSE 0 END) as absents,
      COUNT(*) as total
    FROM presences WHERE date_cours >= date('now', '-7 days')
    GROUP BY date_cours ORDER BY date_cours
  `);
  const evalStats: any = await db.getFirstAsync(
    `SELECT COUNT(*) as total, SUM(CASE WHEN synced=1 THEN 1 ELSE 0 END) as synced FROM evaluations`
  );
  setStats(prev => ({
    ...prev,
    sparkPresences: presences7j.map(r => r.total > 0 ? Math.round((1 - r.absents / r.total) * 100) : 100),
    pctBulletins:   evalStats?.total > 0 ? Math.round((evalStats.synced / evalStats.total) * 100) : 0,
  }));
  ```
- [ ] Ajouter composants inline Sparkline et Jauge :
  ```typescript
  function Sparkline({ data }: { data: number[] }) {
    if (!data.length) return null;
    const max = Math.max(...data, 1);
    const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
    return <Text style={{ fontSize: 14, color: Colors.primary, letterSpacing: 2 }}>
      {data.map(v => bars[Math.min(7, Math.floor((v / max) * 7))]).join('')}
    </Text>;
  }

  function Jauge({ pct }: { pct: number }) {
    const f = Math.round(pct / 10);
    return <Text style={{ fontSize: 12, color: Colors.primary }}>
      {'█'.repeat(f)}{'░'.repeat(10 - f)} {pct}%
    </Text>;
  }
  ```
- [ ] Ajouter section apres les statsRow existantes :
  ```tsx
  {(stats.sparkPresences.length > 0 || stats.pctBulletins > 0) && (
    <View style={styles.sparkRow}>
      {stats.sparkPresences.length > 0 && (
        <View style={styles.sparkCard}>
          <Text style={styles.sparkTitre}>Presences 7 jours</Text>
          <Sparkline data={stats.sparkPresences} />
        </View>
      )}
      {stats.pctBulletins > 0 && (
        <View style={styles.sparkCard}>
          <Text style={styles.sparkTitre}>Evals synchronisees</Text>
          <Jauge pct={stats.pctBulletins} />
        </View>
      )}
    </View>
  )}
  ```
- [ ] Ajouter styles :
  ```typescript
  sparkRow:  { flexDirection: 'row', gap: 10, marginBottom: Spacing.md },
  sparkCard: { flex: 1, backgroundColor: Colors.white, borderRadius: 12,
               padding: Spacing.sm, gap: 6, shadowColor: '#000',
               shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06,
               shadowRadius: 3, elevation: 2 },
  sparkTitre:{ fontSize: 11, color: Colors.gray500, fontWeight: '500' },
  ```

---

## Verification finale

- [ ] `npx tsc --noEmit` dans mobile/ — zero erreur TypeScript
- [ ] App offline : presences enqueues, sync montante fonctionne apres reconnexion
- [ ] Appel : DELETE ne supprime que l'appel courant
- [ ] Login OTP +225 : prefixe correct
- [ ] Redemarrage app : session restauree sans re-login
- [ ] Bottom tabs : navigation fluide enseignant et parent
- [ ] StatCards : animation slide-in au montage
- [ ] Sparklines : visibles quand donnees disponibles (transparents si vides)
