# Messagerie Interne — Design Spec

> Date : 2026-04-07
> Statut : Validé

---

## Contexte

EcoleManager a besoin d'un système de messages internes entre parents et enseignants, centré sur l'élève. Le directeur/censeur supervise l'ensemble des échanges de son établissement.

### Décisions de cadrage

| Question | Décision |
|----------|----------|
| Modèle de conversation | Fils liés à un élève |
| Participants | Parent ↔ Enseignant (directeur supervise) |
| Notifications | In-app + externe configurable (SMS/WhatsApp via préférences) |
| Granularité des fils | Un fil unique par couple (parent, enseignant) pour un élève donné |
| Architecture | Deux tables simples : `conversations` + `messages` |

### Évolutions futures prévues

- Ouverture à d'autres types de conversations (directeur → enseignant, groupes)
- Ajout d'une table `conversation_participants` si besoin multi-acteurs

---

## 1. Schéma de données

Migration `010_messagerie.sql` :

```sql
-- conversations : un fil unique par (parent, enseignant, élève)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  etablissement_id UUID NOT NULL REFERENCES etablissements(id),
  parent_id UUID NOT NULL REFERENCES utilisateurs(id),
  enseignant_id UUID NOT NULL REFERENCES utilisateurs(id),
  eleve_id UUID NOT NULL REFERENCES eleves(id),
  dernier_message_at TIMESTAMPTZ DEFAULT NOW(),
  archived_by_parent BOOLEAN DEFAULT FALSE,
  archived_by_enseignant BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(parent_id, enseignant_id, eleve_id)
);

-- messages : contenu des échanges
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES conversations(id),
  etablissement_id UUID NOT NULL REFERENCES etablissements(id),
  expediteur_id UUID NOT NULL REFERENCES utilisateurs(id),
  contenu TEXT NOT NULL CHECK (char_length(contenu) <= 2000),
  lu BOOLEAN DEFAULT FALSE,
  lu_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Index pour les requêtes fréquentes
CREATE INDEX idx_conversations_parent ON conversations(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_conversations_enseignant ON conversations(enseignant_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_conversations_etablissement ON conversations(etablissement_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_conversations_dernier_msg ON conversations(dernier_message_at DESC);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_messages_non_lus ON messages(conversation_id) WHERE lu = FALSE AND deleted_at IS NULL;
```

### Nouvelles permissions

```sql
-- Ajouter 'messagerie' au CHECK constraint existant
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_domaine_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_domaine_check
  CHECK (domaine IN (
    'notes','absences','discipline','bulletins','edt',
    'eleves','parents','enseignants','config','rapports','admin',
    'messagerie'
  ));

INSERT INTO permissions (code, description, domaine) VALUES
  ('messagerie.voir', 'Voir ses propres conversations', 'messagerie'),
  ('messagerie.envoyer', 'Envoyer un message', 'messagerie'),
  ('messagerie.superviser', 'Voir toutes les conversations de l''établissement', 'messagerie');
```

| Rôle | voir | envoyer | superviser |
|------|------|---------|------------|
| parent | ✅ | ✅ | ❌ |
| enseignant | ✅ | ✅ | ❌ |
| censeur | ✅ | ✅ | ✅ |
| directeur | ✅ | ✅ | ✅ |

---

## 2. Endpoints API

Domaine : `backend/src/domains/06-messagerie/messagerie.routes.js`

| Méthode | Route | Rôle requis | Description |
|---------|-------|-------------|-------------|
| `GET` | `/conversations` | messagerie.voir | Liste mes conversations (paginées, triées par `dernier_message_at`) |
| `POST` | `/conversations` | messagerie.envoyer | Créer/récupérer un fil (upsert sur le triplet parent+enseignant+élève) |
| `GET` | `/conversations/:id/messages` | participant ou superviseur | Messages du fil (paginé, ordre chrono) |
| `POST` | `/conversations/:id/messages` | participant | Envoyer un message |
| `PATCH` | `/conversations/:id/lu` | participant | Marquer comme lus les messages reçus (WHERE `expediteur_id != moi`) |
| `PATCH` | `/conversations/:id/archive` | participant | Archiver/désarchiver la conversation pour l'utilisateur courant |
| `GET` | `/conversations/non-lus` | messagerie.voir | Compteur de messages non lus (pour badge) |

### Règles d'accès

- **Parent** : ne voit que les conversations où `parent_id = req.user.id`
- **Enseignant** : ne voit que celles où `enseignant_id = req.user.id`
- **Directeur/censeur** : voit toutes les conversations de son `etablissement_id`
- Tout est filtré par `etablissement_id` (multi-tenant strict)
- À la création, vérification que l'enseignant a bien l'élève dans une de ses classes. Chemin de jointure : `utilisateurs.id → enseignants.utilisateur_id → enseignants.id → affectations_enseignants.enseignant_id → classe_id → inscriptions.classe_id → inscriptions.eleve_id`

### Réponses

Format standard du projet :
```json
{ "success": true, "data": { ... } }
{ "success": false, "error": "..." }
```

### Notification à l'envoi

Chaque `POST /conversations/:id/messages` enqueue un job BullMQ :
- Récupère `notifications_preferences.canal_prefere` du destinataire
- Envoie via SMS ou WhatsApp (infrastructure existante)
- Message type : "Nouveau message de M. Diop concernant Moussa"

---

## 3. Dashboard

### Fichier : `dashboard/js/pages/messagerie.js`

**Vue liste :**
- Liste des conversations : avatar, nom du correspondant, nom de l'élève, aperçu du dernier message, horodatage, badge non-lu
- Triées par `dernier_message_at` DESC
- Bouton "Nouvelle conversation" → modale de sélection :
  - Enseignant : choisit un parent parmi les élèves de ses classes
  - Parent : choisit un enseignant de son enfant

**Vue chat :**
- Messages affichés en style chat (bulles gauche/droite selon expéditeur)
- Champ de saisie en bas + bouton envoyer
- Marque automatiquement les messages comme lus à l'ouverture
- Scroll automatique vers le dernier message

**Vue directeur (supervision) :**
- Même page mais avec toutes les conversations de l'établissement
- Filtres : par classe, enseignant, parent
- Possibilité d'intervenir (écrire dans un fil)

**Intégration sidebar :**
- Nouvelle entrée "Messagerie" avec icône dans la sidebar (tous les rôles)
- Badge compteur non-lus à côté de l'icône
- Les nouveaux messages apparaissent aussi dans le drawer de notifications existant (`notifs.js`)

---

## 4. Mobile

### Accès

Pas de nouvel onglet — bouton "Messages" avec badge sur le dashboard de chaque rôle :
- `app/(app)/enseignant/messagerie.tsx`
- `app/(app)/parent/messagerie.tsx`

### Écrans

1. **Liste des conversations** — FlatList avec nom du correspondant, élève, dernier message, date, pastille non-lu
2. **Fil de messages** — FlatList inversée (style chat), champ de saisie en bas, envoi via `Api.post`

### Offline-first

- Tables SQLite `conversations_locaux` et `messages_locaux` pour cache offline
- À l'envoi : écriture locale d'abord, puis sync via `syncService`
- Conversations et messages synchronisés via le mécanisme existant (`operations_sync`)

---

## 5. Sécurité

- Vérification que l'expéditeur est participant de la conversation (`parent_id` ou `enseignant_id`), OU détient la permission `messagerie.superviser` (directeur/censeur — peut lire et intervenir dans tout fil de son établissement)
- Un parent ne peut initier une conversation qu'avec un enseignant qui a son enfant en classe (vérifié via jointure `affectations_enseignants` → `inscriptions`)
- Contenu limité à 2000 caractères par message (CHECK constraint SQL + validation Zod)
- Rate limiting : max 30 messages/minute par utilisateur
- Filtrage `etablissement_id` sur toutes les requêtes (multi-tenant strict)
- Soft delete (`deleted_at`) sur conversations et messages

---

## 6. Tests

Fichier : `backend/tests/domains/messagerie.test.js`

Cas couverts (~9 tests) :
1. Créer une conversation (upsert — retourne l'existante si triplet existe)
2. Envoyer un message et vérifier qu'il apparaît dans le fil
3. Marquer les messages comme lus (PATCH)
4. Compteur non-lus
5. Accès refusé si l'utilisateur n'est pas participant
6. Le directeur peut lire et intervenir dans un fil
7. Un parent ne peut pas écrire à un enseignant qui n'a pas son enfant
8. Pagination des messages
9. Notification externe enqueued après envoi

Pattern : mocks de `getDB`, fixtures, `testApp` helper (identique aux 9 suites existantes).

---

## Résumé des livrables

| Composant | Fichier(s) | Volume estimé |
|-----------|------------|---------------|
| Migration SQL | `migrations/010_messagerie.sql` | ~60 lignes |
| Routes backend | `backend/src/domains/06-messagerie/messagerie.routes.js` | ~300 lignes |
| Tests unitaires | `backend/tests/domains/messagerie.test.js` | ~200 lignes |
| Dashboard page | `dashboard/js/pages/messagerie.js` | ~400 lignes |
| Dashboard CSS | `dashboard/css/style.css` (ajouts) | ~100 lignes |
| Dashboard HTML | `dashboard/index.html` (sidebar + page) | ~30 lignes |
| Mobile enseignant | `mobile/app/(app)/enseignant/messagerie.tsx` | ~250 lignes |
| Mobile parent | `mobile/app/(app)/parent/messagerie.tsx` | ~250 lignes |
| Mobile SQLite | `mobile/src/services/storage/database.ts` (ajouts) | ~20 lignes |
