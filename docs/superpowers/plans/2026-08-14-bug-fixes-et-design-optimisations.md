# Bug Fixes + Design Optimisations — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corriger les 6 bugs identifies a l'audit et appliquer les 6 optimisations design/performance du mobile EcoleManager.

**Architecture:** Les corrections touchent 3 couches independantes — backend Node.js (guard Redis), services mobile SQLite (UUID, retry ops), et UI mobile React Native (theme, sync banner, performance). Elles sont toutes non-destructives et peuvent etre appliquees une par une.

**Tech Stack:** Node.js 20 / Express (backend), React Native 0.76 / Expo SDK 52 / SQLite (mobile), Zustand (state), Ionicons (icons)

---

## Chunk 1 : Bug Fixes — Services & Infra

### Task 1 : P1 — Verifier le guard Redis (deja corrige, confirmer)

**Files:**
- Read: `backend/src/app.js:245-252`

- [ ] **Step 1: Lire les lignes 245-252 de app.js**

  Verifier que `initPurgeWorker()` est bien DANS le bloc `if (process.env.REDIS_URL || process.env.REDIS_HOST)`.

  Code attendu actuel (CORRECT) :
  ```js
  if (process.env.REDIS_URL || process.env.REDIS_HOST) {
    await connectRedis();
    logger.info('Redis connecte');
    initPurgeWorker();
    logger.info('Worker de purge initialise');
  } else {
    logger.warn('Redis non configure — desactive');
  }
  ```

- [ ] **Step 2: Si conforme → aucune modification.**

  Si non conforme (double appel hors du bloc) :
  ```js
  // Supprimer la ligne parasite hors du bloc if
  // initPurgeWorker();   <- a retirer
  ```

---

### Task 2 : P2 — Corriger l'UUID dans `ajouterOperationPendante`

**Files:**
- Modify: `mobile/src/services/storage/database.ts` (fonction `ajouterOperationPendante`)

**Probleme:** L'ID de chaque operation pending est `Date.now().toString()` — risque de collision si 2 operations sont creees la meme milliseconde. `react-native-uuid` est deja installe.

- [ ] **Step 1: Lire la fonction actuelle**

  Localiser dans `database.ts` :
  ```ts
  export async function ajouterOperationPendante(type: string, payload: object): Promise<void> {
    const db = getDB();
    const { v4: uuid } = await import('react-native-uuid' as any).catch(...);
    await db.runAsync(
      `INSERT INTO operations_pending (id, type, payload) VALUES (?, ?, ?)`,
      [Date.now().toString(), type, JSON.stringify(payload)]  // <- bug ici
    );
  }
  ```

- [ ] **Step 2: Corriger — utiliser le uuid importe**

  Remplacer `Date.now().toString()` par `uuid()` :
  ```ts
  export async function ajouterOperationPendante(type: string, payload: object): Promise<void> {
    const db = getDB();
    const { v4: uuid } = await import('react-native-uuid' as any)
      .catch(() => ({ v4: () => Date.now().toString() }));
    await db.runAsync(
      `INSERT INTO operations_pending (id, type, payload) VALUES (?, ?, ?)`,
      [uuid() as string, type, JSON.stringify(payload)]
    );
  }
  ```

- [ ] **Step 3: Verifier le test existant**

  ```bash
  cd mobile && npx jest __tests__/services/database.test.ts --no-coverage
  ```
  Attendu : tous les tests passent.

- [ ] **Step 4: Commit**

  ```bash
  git add mobile/src/services/storage/database.ts
  git commit -m "fix(mobile): utiliser uuid v4 dans ajouterOperationPendante"
  ```

---

### Task 3 : P3 — Supprimer l'import SecureStore mort dans client.ts

**Files:**
- Modify: `mobile/src/services/api/client.ts:4`

**Probleme:** `import * as SecureStore from 'expo-secure-store'` est importe mais jamais utilise dans ce fichier (SecureStore est utilise dans `authStore.ts` uniquement).

- [ ] **Step 1: Supprimer la ligne 4**

  Avant :
  ```ts
  import * as SecureStore from 'expo-secure-store';
  import * as Network from 'expo-network';
  ```

  Apres :
  ```ts
  import * as Network from 'expo-network';
  ```

- [ ] **Step 2: Verifier que rien ne casse**

  ```bash
  cd mobile && npx tsc --noEmit
  ```
  Attendu : 0 erreur TypeScript.

- [ ] **Step 3: Commit**

  ```bash
  git add mobile/src/services/api/client.ts
  git commit -m "fix(mobile): supprimer import SecureStore inutilise dans client.ts"
  ```

---

### Task 4 : P4 — Retirer axios et @tanstack/react-query du package.json

**Files:**
- Modify: `mobile/package.json`

**Probleme:** `axios` (~40kb) et `@tanstack/react-query` (~45kb) sont declares comme dependances mais aucun fichier du projet ne les importe. Le client HTTP utilise `fetch` natif.

- [ ] **Step 1: Confirmer qu'aucun fichier ne les importe**

  Rechercher dans `mobile/` :
  - `from 'axios'` -> doit retourner 0 resultat
  - `from '@tanstack/react-query'` -> doit retourner 0 resultat

- [ ] **Step 2: Supprimer les deux entrees de package.json**

  Dans `mobile/package.json`, retirer :
  ```json
  "axios": "^1.6.8",
  "@tanstack/react-query": "^5.56.2",
  ```

- [ ] **Step 3: Reinstaller les dependances**

  ```bash
  cd mobile && npm install
  ```

- [ ] **Step 4: Verifier que l'app compile**

  ```bash
  cd mobile && npx expo export --platform android --dev 2>&1 | tail -5
  ```
  Attendu : pas d'erreur de module manquant.

- [ ] **Step 5: Commit**

  ```bash
  git add mobile/package.json mobile/package-lock.json
  git commit -m "chore(mobile): retirer axios et react-query inutilises (-85kb bundle)"
  ```

---

### Task 5 : P5 — Permettre le retry des operations en statut='erreur'

**Files:**
- Modify: `mobile/src/services/storage/database.ts` (fonction `getOperationsPendantes`)

**Probleme:** `getOperationsPendantes` ne recupere que `statut='en_attente'`. Les ops en `statut='erreur'` ne sont jamais reessayees.

**Regle de retry :** Reessayer si `tentatives < 5`. Apres 5 echecs : erreur definitive.

- [ ] **Step 1: Modifier `getOperationsPendantes`**

  Avant :
  ```ts
  export async function getOperationsPendantes(): Promise<any[]> {
    return getDB().getAllAsync(
      `SELECT * FROM operations_pending WHERE statut='en_attente' ORDER BY created_at_local LIMIT 50`
    );
  }
  ```

  Apres :
  ```ts
  export async function getOperationsPendantes(): Promise<any[]> {
    return getDB().getAllAsync(
      `SELECT * FROM operations_pending
       WHERE (statut = 'en_attente') OR (statut = 'erreur' AND tentatives < 5)
       ORDER BY created_at_local
       LIMIT 50`
    );
  }
  ```

- [ ] **Step 2: Verifier les tests**

  ```bash
  cd mobile && npx jest __tests__/services/database.test.ts --no-coverage
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add mobile/src/services/storage/database.ts
  git commit -m "fix(mobile): relancer les operations en erreur (max 5 tentatives)"
  ```

---

### Task 6 : P6 — Supprimer data-mock.js du dashboard

**Files:**
- Delete: `dashboard/js/data-mock.js`
- Modify: `dashboard/index.html` (retirer le script tag si present)

**Probleme:** Donnees fictives toujours chargees alors que les pages utilisent l'API reelle.

- [ ] **Step 1: Verifier que data-mock.js n'est plus reference**

  Dans `dashboard/js/pages/*.js`, chercher les variables `ELEVES`, `EVALS`, `ABS`, `BULL`, `CLASSES`. Si des references existent, les corriger avant de supprimer.

- [ ] **Step 2: Retirer le script tag dans index.html**

  Chercher `<script src="js/data-mock.js">` dans `dashboard/index.html` et le retirer.

- [ ] **Step 3: Supprimer le fichier**

  Supprimer `dashboard/js/data-mock.js`.

- [ ] **Step 4: Tester le dashboard**

  Ouvrir `dashboard/index.html` avec le backend demarre. Verifier 0 erreur console.

- [ ] **Step 5: Commit**

  ```bash
  git add -u dashboard/
  git commit -m "chore(dashboard): supprimer data-mock.js — API reelle utilisee"
  ```

---

## Chunk 2 : Design & Performance — Mobile UI

### Task 7 : Unifier les deux systemes de theme

**Files:**
- Delete: `mobile/src/constants/theme.ts`
- Modify: `mobile/app/(app)/enseignant/_layout.tsx`
- Modify: `mobile/app/(app)/parent/_layout.tsx`

**Probleme:** `src/constants/theme.ts` (`COULEURS`, `TYPOGRAPHIE`) duplique `src/utils/theme.ts` (`Colors`, `Typography`). Un seul fichier doit etre la source de verite.

- [ ] **Step 1: Modifier `enseignant/_layout.tsx`**

  Avant :
  ```tsx
  import { COULEURS, TYPOGRAPHIE } from '../../../src/constants/theme';
  // tabBarActiveTintColor: COULEURS.vert,
  // tabBarInactiveTintColor: COULEURS.grisMoyen,
  // backgroundColor: COULEURS.blanc,
  // borderTopColor: COULEURS.grisClaire,
  // fontSize: TYPOGRAPHIE.xxs,
  ```

  Apres :
  ```tsx
  import { Colors } from '../../../src/utils/theme';
  // tabBarActiveTintColor: Colors.primary,
  // tabBarInactiveTintColor: Colors.gray400,
  // backgroundColor: Colors.white,
  // borderTopColor: Colors.gray200,
  // fontSize: 10,
  ```

- [ ] **Step 2: Meme modification dans `parent/_layout.tsx`**

- [ ] **Step 3: Supprimer `src/constants/theme.ts`**

- [ ] **Step 4: TypeScript check**

  ```bash
  cd mobile && npx tsc --noEmit
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add mobile/src/constants/theme.ts \
          mobile/app/(app)/enseignant/_layout.tsx \
          mobile/app/(app)/parent/_layout.tsx
  git commit -m "refactor(mobile): unifier design system — supprimer constants/theme.ts"
  ```

---

### Task 8 : Supprimer COULEURS_MATIERES dupliquees

**Files:**
- Modify: `mobile/src/utils/theme.ts` (ajouter `couleurMatiere`)
- Modify: `mobile/app/(app)/enseignant/index.tsx` (supprimer `COULEURS_MATIERES`)

**Probleme:** `COULEURS_MATIERES` dans `enseignant/index.tsx` duplique les tokens `Colors.maths`, `Colors.physique` etc. deja dans `theme.ts`.

- [ ] **Step 1: Ajouter `couleurMatiere()` dans theme.ts**

  A la fin de `mobile/src/utils/theme.ts`, ajouter :
  ```ts
  export function couleurMatiere(matiere: string): string {
    const map: Record<string, string> = {
      'Mathematiques':        Colors.maths,
      'Physique-Chimie':      Colors.physique,
      'SVT':                  Colors.svt,
      'Francais':             Colors.francais,
      'Histoire-Geographie':  Colors.histoire,
      'Anglais':              Colors.anglais,
      'Philosophie':          Colors.philosophie,
      'EPS':                  Colors.eps,
      'Technologie':          Colors.techno,
    };
    return map[matiere] ?? Colors.primary;
  }
  ```

- [ ] **Step 2: Dans `enseignant/index.tsx`**

  - Supprimer la declaration `const COULEURS_MATIERES = {...}` (lignes 16-19)
  - Ajouter `couleurMatiere` dans l'import depuis `theme.ts`
  - Remplacer chaque `COULEURS_MATIERES[c.matiere] || COULEURS_MATIERES.default` par `couleurMatiere(c.matiere)`

- [ ] **Step 3: TypeScript check**

  ```bash
  cd mobile && npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add mobile/src/utils/theme.ts mobile/app/(app)/enseignant/index.tsx
  git commit -m "refactor(mobile): centraliser couleurMatiere() dans theme.ts"
  ```

---

### Task 9 : Composant SyncStatus — bandeau etat synchronisation

**Files:**
- Create: `mobile/src/components/ui/SyncStatus.tsx`
- Modify: `mobile/app/(app)/enseignant/index.tsx`
- Modify: `mobile/app/(app)/parent/index.tsx`

**But:** Afficher l'etat de sync en haut des dashboards. Critique pour la confiance utilisateur sur terrain 2G/3G.

**4 etats visuels :**
- `ok` + 0 pending -> invisible (ne pas polluer l'ecran)
- `en_attente` -> bandeau orange "N elements en attente"
- `erreur` -> bandeau rouge "Sync echouee — Appuyer pour reessayer"
- `hors_ligne` -> bandeau gris "Hors ligne — donnees locales"

- [ ] **Step 1: Creer `SyncStatus.tsx`**

  ```tsx
  // mobile/src/components/ui/SyncStatus.tsx
  import React from 'react';
  import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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
      ok:         'Synchronise',
      en_attente: `${nbEnAttente} element${nbEnAttente > 1 ? 's' : ''} en attente`,
      erreur:     'Sync echouee — Appuyer pour reessayer',
      hors_ligne: 'Hors ligne — donnees locales',
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
  ```

- [ ] **Step 2: Integrer dans `enseignant/index.tsx`**

  Ajouter l'import et l'etat :
  ```tsx
  import SyncStatus, { StatutSync } from '../../../src/components/ui/SyncStatus';
  // ...
  const [statutSync, setStatutSync] = useState<StatutSync>('ok');
  ```

  Dans `charger()`, apres `setStats(...)` :
  ```tsx
  setStatutSync(stats.notes_en_attente > 0 ? 'en_attente' : 'ok');
  ```

  Dans `handleRefresh()`, gerer l'erreur :
  ```tsx
  async function handleRefresh() {
    setRefresh(true);
    try {
      await syncService.syncComplete();
      setStatutSync('ok');
    } catch {
      setStatutSync('erreur');
    }
    await charger();
    setRefresh(false);
  }
  ```

  Dans le JSX, placer apres le header :
  ```tsx
  <SyncStatus
    statut={statutSync}
    nbEnAttente={stats.notes_en_attente}
    onPresser={handleRefresh}
  />
  ```

- [ ] **Step 3: Integrer dans `parent/index.tsx` de la meme facon**

  Le parent affiche `hors_ligne` si la sync echoue, `ok` sinon (pas de notes en attente cote parent).

- [ ] **Step 4: TypeScript check**

  ```bash
  cd mobile && npx tsc --noEmit
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add mobile/src/components/ui/SyncStatus.tsx \
          mobile/app/(app)/enseignant/index.tsx \
          mobile/app/(app)/parent/index.tsx
  git commit -m "feat(mobile): SyncStatus — bandeau etat synchronisation visible"
  ```

---

### Task 10 : EDT dans Zustand — eliminer les requetes SQLite repetees

**Files:**
- Create: `mobile/src/stores/edtStore.ts`
- Modify: `mobile/app/(app)/enseignant/index.tsx`

**Probleme:** L'EDT est recharge depuis SQLite a chaque montage de l'ecran. L'EDT ne change qu'a la sync (5min). Un store Zustand evite ces requetes inutiles a chaque navigation retour.

- [ ] **Step 1: Creer `edtStore.ts`**

  ```ts
  // mobile/src/stores/edtStore.ts
  import { create } from 'zustand';

  interface CreneauEdt {
    id:           string;
    jour_semaine: number;
    heure_debut:  string;
    heure_fin:    string;
    matiere:      string;
    classe_id:    string | null;
    classe:       string | null;
    salle:        string | null;
  }

  interface EdtState {
    creneaux:    CreneauEdt[];
    setCreneaux: (creneaux: CreneauEdt[]) => void;
    vider:       () => void;
  }

  export const useEdtStore = create<EdtState>((set) => ({
    creneaux:    [],
    setCreneaux: (creneaux) => set({ creneaux }),
    vider:       () => set({ creneaux: [] }),
  }));
  ```

- [ ] **Step 2: Modifier `enseignant/index.tsx`**

  ```tsx
  import { useEdtStore } from '../../../src/stores/edtStore';

  // Remplacer le useState local :
  // const [edt, setEdt] = useState<any[]>([]);  <- supprimer

  const creneaux    = useEdtStore(s => s.creneaux);
  const setCreneaux = useEdtStore(s => s.setCreneaux);

  // Dans charger() — charger depuis SQLite seulement si cache vide :
  const edtRows = creneaux.length === 0
    ? await db.getAllAsync('SELECT * FROM edt ORDER BY jour_semaine, heure_debut')
    : creneaux;
  setCreneaux(edtRows as any[]);

  // Dans handleRefresh() — invalider le cache apres sync :
  useEdtStore.getState().vider();
  await syncService.syncComplete();
  await charger();
  ```

  Remplacer `edt.filter(...)` par `creneaux.filter(...)` dans `coursJour`.

- [ ] **Step 3: TypeScript check**

  ```bash
  cd mobile && npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add mobile/src/stores/edtStore.ts mobile/app/(app)/enseignant/index.tsx
  git commit -m "perf(mobile): cache EDT dans Zustand — eliminer requetes SQLite repetees"
  ```

---

### Task 11 : FlatList pour les cours de l'EDT

**Files:**
- Modify: `mobile/app/(app)/enseignant/index.tsx`

**Probleme:** Les cours du jour sont rendus avec `.map()` dans un `ScrollView`. Sur appareils d'entree de gamme (Tecno, Infinix), avec 8+ cours le rendu est bloquant. Utiliser `FlatList` avec `scrollEnabled={false}` dans le ScrollView parent.

- [ ] **Step 1: Verifier que `FlatList` est importe**

  Dans la ligne d'import `react-native` :
  ```tsx
  import { View, Text, StyleSheet, ScrollView, TouchableOpacity,
           RefreshControl, FlatList } from 'react-native';
  ```

- [ ] **Step 2: Remplacer le `.map()` des cours**

  Avant :
  ```tsx
  {coursJour.length === 0
    ? <Carte>...</Carte>
    : coursJour.map((c, i) => (
        <TouchableOpacity key={i} ...>...</TouchableOpacity>
      ))
  }
  ```

  Apres :
  ```tsx
  {coursJour.length === 0
    ? <Carte><Text style={styles.aucun}>Aucun cours ce {JOURS[jourActif]}</Text></Carte>
    : (
        <FlatList
          data={coursJour}
          keyExtractor={(c) => c.id || `${c.jour_semaine}-${c.heure_debut}`}
          scrollEnabled={false}
          renderItem={({ item: c }) => (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => router.push({
                pathname: '/(app)/enseignant/appel',
                params: { cours_id: c.id, classe: c.classe },
              })}
            >
              <Carte
                style={{ ...styles.coursCard, borderLeftColor: couleurMatiere(c.matiere) }}
                padding={12}
              >
                <View style={styles.coursLigne}>
                  <View style={[styles.coursHeure, { backgroundColor: couleurMatiere(c.matiere) + '15' }]}>
                    <Text style={[styles.coursHeureTxt, { color: couleurMatiere(c.matiere) }]}>
                      {c.heure_debut?.slice(0, 5)}
                    </Text>
                    <Text style={[styles.coursHeureFin, { color: couleurMatiere(c.matiere) }]}>
                      {c.heure_fin?.slice(0, 5)}
                    </Text>
                  </View>
                  <View style={styles.coursInfo}>
                    <Text style={styles.coursMatiere}>{c.matiere}</Text>
                    <Text style={styles.coursClasse}>{c.classe}{c.salle ? ' · ' + c.salle : ''}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={Colors.gray400} />
                </View>
              </Carte>
            </TouchableOpacity>
          )}
        />
      )
  }
  ```

- [ ] **Step 3: TypeScript check**

  ```bash
  cd mobile && npx tsc --noEmit
  ```

- [ ] **Step 4: Commit**

  ```bash
  git add mobile/app/(app)/enseignant/index.tsx
  git commit -m "perf(mobile): FlatList pour les cours EDT — rendu virtualise"
  ```

---

## Recapitulatif des 10 commits

| Task | Commit message | Impact |
|------|---------------|--------|
| T1 | (verification — aucun commit si deja OK) | Guard Redis confirme |
| T2 | fix(mobile): utiliser uuid v4 dans ajouterOperationPendante | Bug UUID |
| T3 | fix(mobile): supprimer import SecureStore inutilise dans client.ts | Nettoyage |
| T4 | chore(mobile): retirer axios et react-query inutilises (-85kb bundle) | -85kb bundle |
| T5 | fix(mobile): relancer les operations en erreur (max 5 tentatives) | Fiabilite sync |
| T6 | chore(dashboard): supprimer data-mock.js | Nettoyage |
| T7 | refactor(mobile): unifier design system — supprimer constants/theme.ts | Maintenabilite |
| T8 | refactor(mobile): centraliser couleurMatiere() dans theme.ts | Coherence |
| T9 | feat(mobile): SyncStatus — bandeau etat synchronisation visible | UX terrain |
| T10 | perf(mobile): cache EDT dans Zustand — eliminer requetes SQLite repetees | -N requetes SQLite |
| T11 | perf(mobile): FlatList pour les cours EDT — rendu virtualise | Performance rendu |
