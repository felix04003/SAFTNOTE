# DESIGN.md — EcoleManager Mobile

Documente le système de design **existant** (extrait de `src/utils/theme.ts` et des écrans réels), audité en conditions réelles sur émulateur Android à travers plusieurs passages. Ce n'est pas une proposition — c'est ce qui est effectivement construit et vérifié aujourd'hui.

## Produit

App mobile React Native/Expo pour la gestion scolaire en Afrique de l'Ouest francophone (offline-first, SQLite local + sync serveur). Deux rôles : enseignant (saisie de présences/notes, consultation EDT/classes) et parent (consultation absences/notes/bulletins de leurs enfants).

**Ce qu'on veut que l'utilisateur retienne** : une app sérieuse et digne de confiance pour un contexte à connectivité limitée — pas un jouet, pas une app "startup" générique.

## Couleurs

Palette "Afrique de l'Ouest" — vert forêt (confiance, nature) + orange (dynamisme, Afrique).

```ts
primary:      '#1A4731'  // vert forêt — header, boutons principaux, accents forts
primaryDark:  '#0F2A1D'
primaryLight: '#2C6E49'  // accents secondaires
primaryBg:    '#EAF4EE'  // fonds teintés (badges, sélections actives)

accent:       '#E07B39'  // orange — CTA secondaires, alertes de sync
accentLight:  '#FDF2E9'

blue:   '#1A5276'  // académique/notes
danger: '#C0392B'  // absences, erreurs
success:'#27AE60'  // présent, validé
warning:'#F39C12'  // retard, en attente
info:   '#2E86C1'  // dispensé, neutre-informatif
```
Chaque couleur sémantique a une variante `xxxLight` (fond teinté à ~10%) pour badges/bannières.

**Couleurs par matière** (identité visuelle constante, une seule source de vérité — `couleurMatiere()`) : Mathématiques `#1A5276`, Physique-Chimie `#7D3C98`, SVT `#1E8449`, Français `#B7950B`, Histoire-Géo `#935116`, Anglais `#1A5276`, Philosophie `#6C3483`, EPS `#1A6B3A`, Technologie `#1B4F72`.

**Neutres** : `gray50`→`gray900` (échelle Tailwind-like), `background: '#F5F5F0'` (fond app, légèrement chaud, pas blanc pur), `surface: '#FFFFFF'`, `border: '#E5E7EB'`.

**Note native, pas web** : contrairement aux recommandations web, suivre la police système (San Francisco/Roboto) est ici approprié — c'est la convention mobile, pas un signe de paresse.

## Typographie

Aucune police custom chargée — police système (iOS: San Francisco, Android: Roboto). Cohérent avec les conventions natives.

```ts
Typography.xs   = 11   // captions, labels — PLANCHER, jamais en dessous (audit : 8 endroits le violaient, tous corrigés)
Typography.sm   = 13   // texte secondaire
Typography.base = 15   // texte courant
Typography.md   = 17   // sous-titres
Typography.lg   = 20   // titres de section
Typography.xl   = 24   // titres d'écran
Typography.xxl  = 30
Typography.xxxl = 36   // grands nombres (StatCard, NoteBulle taille lg)

weights: regular 400, medium 500, semibold 600, bold 700, black_w 900
```

## Espacement

Échelle stricte à 4 valeurs de base — ne jamais introduire de valeur magique en dehors.

```ts
Spacing.xs = 4, sm = 8, md = 16, lg = 24, xl = 32, xxl = 48
```

## Rayons & Ombres

```ts
Radius.sm = 6, md = 12, lg = 20, xl = 32, full = 9999

Shadow.sm  → shadowOpacity 0.06, shadowRadius 3,  elevation 2  (cartes standard)
Shadow.md  → shadowOpacity 0.10, shadowRadius 8,  elevation 4  (boutons, cartes actives)
Shadow.lg  → shadowOpacity 0.15, shadowRadius 16, elevation 8  (modales)
```

## Composants partagés (`src/components/ui/`)

Toujours réutiliser ceux-ci plutôt que du `TouchableOpacity`/`View` fait main — c'est la règle la plus violée dans l'audit (composant `Bouton` créé mais jamais utilisé jusqu'à correction).

| Composant | Usage |
|---|---|
| `Carte` | Conteneur standard (fond blanc, radius md, ombre sm) |
| `Bouton` | 4 variantes (primaire/secondaire/danger/fantôme), état loading intégré |
| `Badge` | Statuts (présence, mention) — variantes success/danger/warning/info/primary/neutral |
| `Entete` | Header d'écran (fond couleur, retour, sous-titre) |
| `StatCard` | Carte chiffre-clé avec icône, animation d'entrée en cascade (spring, stagger par `index`) |
| `NoteBulle` | Note sur 20 dans un cercle coloré selon `couleurNote()` |
| `EmptyState` | État vide avec icône + message + action optionnelle |
| `SyncStatus` | Bandeau d'état de sync (4 états : ok/en_attente/erreur/hors_ligne), invisible si tout va bien |
| `Loader` | Spinner + message |

## Motion

- Entrée en cascade des `StatCard` via Reanimated (spring, délai = `index * 120ms`) — mouvement intentionnel, pas décoratif.
- Haptics (`expo-haptics`, impact léger) sur les actions de statut fréquentes (ex. marquer une présence).
- `Toast` (react-native-toast-message) pour le feedback de sauvegarde routinier — `Alert.alert` réservé aux actions destructives/irréversibles (clôture d'appel, déconnexion).

## Règles dures (issues de l'audit — ne pas régresser)

1. **Jamais de texte JSX brut avec `\\'`** — l'échappement n'est interprété que dans une string JS, pas dans du texte JSX direct. Utiliser une vraie apostrophe `'` ou une string interpolée.
2. **`Typography.xs` (11px) est le plancher.** Ne jamais soustraire (`Typography.xs - 1`) pour un texte "un peu plus petit" — c'est le réflexe qui a produit 8 violations en dessous de 12px.
3. **Touch targets ≥ 44px**, ou `hitSlop` compensatoire ({top,bottom,left,right}: 8 minimum) si la taille visuelle doit rester petite pour la densité. Attention au chevauchement entre éléments adjacents rapprochés (`gap` < 2×hitSlop).
4. **Toujours formater les dates** (`toLocaleDateString('fr-FR', ...)`) — jamais afficher un ISO brut.
5. **Protéger tout champ potentiellement `undefined`/`null`** avec un fallback explicite (`|| '—'`) avant interpolation dans du texte — sinon "undefined" s'affiche littéralement à l'écran.
6. **Un écran accessible depuis plusieurs points d'entrée doit fonctionner sans paramètres**, ou ne pas être exposé comme point d'entrée direct (onglet, action rapide) s'il en a structurellement besoin. Cas réel : `notes-saisie.tsx` retiré de la barre d'onglets car il nécessite un `evaluation_id` qu'aucun défaut ne peut fournir.

## Ce qui n'est PAS couvert par ce document

Le dashboard web (`dashboard/`, HTML/CSS/JS vanilla, palette et conventions propres, pas partagées avec le mobile) n'est pas documenté ici — système visuellement cohérent avec le mobile (même palette de base) mais implémenté séparément, sans tokens partagés.

---
*Document généré à partir de l'état réel du code au 2026-08-19, après plusieurs passages d'audit visuel en conditions réelles (émulateur Android, comptes de test enseignant/parent). Pas une proposition — une photographie de ce qui existe et fonctionne.*
