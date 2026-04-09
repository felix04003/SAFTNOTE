# Messagerie Interne — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement an internal messaging system between parents and teachers, tied to students, with director supervision and SMS/WhatsApp notifications.

**Architecture:** Two tables (`conversations`, `messages`) with a new backend domain `06-messagerie`, a dashboard page using the existing vanilla JS PAGE_HOOKS pattern, and mobile React Native screens. Notifications leverage the existing BullMQ + SMS/WhatsApp infrastructure.

**Tech Stack:** Node.js/Express, Knex (PostgreSQL), BullMQ, Zod, vanilla JS (dashboard), React Native/Expo (mobile)

**Spec:** `docs/superpowers/specs/2026-04-07-messagerie-interne-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `migrations/010_messagerie.sql` | Schema: tables, indexes, permissions, role assignments |
| `backend/src/domains/06-messagerie/messagerie.routes.js` | 7 API endpoints (CRUD conversations + messages) |
| `backend/tests/domains/messagerie.routes.test.js` | ~10 unit tests |
| `dashboard/js/pages/messagerie.js` | Dashboard page: conversation list + chat view |
| `mobile/app/(app)/enseignant/messagerie.tsx` | Teacher messaging screen |
| `mobile/app/(app)/parent/messagerie.tsx` | Parent messaging screen |

### Modified Files
| File | Change |
|------|--------|
| `backend/src/app.js` | Mount messagerie router |
| `backend/tests/helpers/mockKnex.js` | Add `whereNot`, `clearSelect`, `clearOrder` to chainable mock |
| `backend/tests/helpers/fixtures.js` | Add conversation + message fixtures |
| `dashboard/index.html` | Add sidebar entry + page container (admin portal) |
| `dashboard/enseignant.html` | Add sidebar entry + page container (enseignant portal) |
| `dashboard/parent.html` | Add sidebar entry + page container (parent portal) |
| `dashboard/css/style.css` | Add chat bubble styles, message list styles |
| `dashboard/js/api.js` | Add `Api.patch` method |
| `dashboard/js/router.js` | Add `messagerie` to `TITRES` |
| `dashboard/js/notifs.js` | Add `messages_recus` category to drawer |
| `mobile/src/services/storage/database.ts` | Add SQLite tables for offline cache |

---

## Chunk 1: Database Migration

### Task 1: Write migration SQL

**Files:**
- Create: `migrations/010_messagerie.sql`
- Modify: `migrations/run_all_migrations.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migrations/010_messagerie.sql
-- Messagerie interne — conversations parent ↔ enseignant liées à un élève

BEGIN;

-- ═══════════════════════════════════════════════════
-- 1. Tables
-- ═══════════════════════════════════════════════════

CREATE TABLE conversations (
    id                    UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    etablissement_id      UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    parent_id             UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    enseignant_id         UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    eleve_id              UUID        NOT NULL REFERENCES eleves(id) ON DELETE CASCADE,
    dernier_message_at    TIMESTAMPTZ DEFAULT NOW(),
    archived_by_parent    BOOLEAN     DEFAULT FALSE,
    archived_by_enseignant BOOLEAN    DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW(),
    deleted_at            TIMESTAMPTZ,
    UNIQUE(parent_id, enseignant_id, eleve_id)
);

CREATE TABLE messages (
    id                UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id   UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    etablissement_id  UUID        NOT NULL REFERENCES etablissements(id) ON DELETE CASCADE,
    expediteur_id     UUID        NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
    contenu           TEXT        NOT NULL CHECK (char_length(contenu) <= 2000),
    lu                BOOLEAN     DEFAULT FALSE,
    lu_at             TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    deleted_at        TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════
-- 2. Index
-- ═══════════════════════════════════════════════════

CREATE INDEX idx_conv_parent        ON conversations(parent_id)        WHERE deleted_at IS NULL;
CREATE INDEX idx_conv_enseignant    ON conversations(enseignant_id)    WHERE deleted_at IS NULL;
CREATE INDEX idx_conv_etablissement ON conversations(etablissement_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_conv_dernier_msg   ON conversations(dernier_message_at DESC);
CREATE INDEX idx_msg_conversation   ON messages(conversation_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_msg_non_lus        ON messages(conversation_id) WHERE lu = FALSE AND deleted_at IS NULL;

-- ═══════════════════════════════════════════════════
-- 3. Permissions
-- ═══════════════════════════════════════════════════

-- Etendre le CHECK constraint pour accepter 'messagerie'
ALTER TABLE permissions DROP CONSTRAINT IF EXISTS permissions_domaine_check;
ALTER TABLE permissions ADD CONSTRAINT permissions_domaine_check
    CHECK (domaine IN (
        'notes','absences','discipline','bulletins','edt',
        'eleves','parents','enseignants','config','rapports','admin',
        'messagerie'
    ));

INSERT INTO permissions (code, description, domaine) VALUES
    ('messagerie.voir',       'Voir ses propres conversations',                    'messagerie'),
    ('messagerie.envoyer',    'Envoyer un message',                                'messagerie'),
    ('messagerie.superviser', 'Voir toutes les conversations de l''établissement',  'messagerie');

-- ═══════════════════════════════════════════════════
-- 4. Attribution permissions aux rôles
-- ═══════════════════════════════════════════════════

-- parent, enseignant : voir + envoyer
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('parent', 'enseignant')
  AND p.code IN ('messagerie.voir', 'messagerie.envoyer');

-- directeur, censeur : voir + envoyer + superviser
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code IN ('directeur', 'censeur')
  AND p.code IN ('messagerie.voir', 'messagerie.envoyer', 'messagerie.superviser');

-- super_admin : toutes les permissions messagerie
INSERT INTO roles_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.code = 'super_admin'
  AND p.domaine = 'messagerie';

COMMIT;
```

- [ ] **Step 2: Add to run_all_migrations.sql**

First verify that `\i 009_fix_statut_checks.sql` is included. If not, add it. Then append:
```sql
\i 009_fix_statut_checks.sql
\i 010_messagerie.sql
```

- [ ] **Step 3: Commit**

```bash
git add migrations/010_messagerie.sql migrations/run_all_migrations.sql
git commit -m "feat(db): add migration 010 — messagerie tables, indexes, permissions"
```

---

## Chunk 2: Backend Routes (TDD)

### Task 2: Set up test file with mocks, fixtures, and extend mockKnex

**Files:**
- Create: `backend/tests/domains/messagerie.routes.test.js`
- Create: `backend/src/domains/06-messagerie/messagerie.routes.js` (empty router)
- Modify: `backend/tests/helpers/mockKnex.js` — add missing chainable methods
- Modify: `backend/tests/helpers/fixtures.js` — add messagerie fixtures

- [ ] **Step 1: Extend mockKnex.js**

Add `whereNot`, `whereNull`, `clearSelect`, `clearOrder` to the chainable methods list in `backend/tests/helpers/mockKnex.js`:

```javascript
// Add to the chainable methods array alongside existing ones (where, join, select, etc.):
'whereNot', 'whereNull', 'clearSelect', 'clearOrder',
```

- [ ] **Step 2: Add fixtures to fixtures.js**

Add to `backend/tests/helpers/fixtures.js`:

```javascript
const conversation = {
  id: IDS.conversation || '00000000-0000-4000-a000-000000000055',
  etablissement_id: IDS.etablissement,
  parent_id: '00000000-0000-4000-a000-000000000011',
  enseignant_id: '00000000-0000-4000-a000-000000000022',
  eleve_id: '00000000-0000-4000-a000-000000000044',
  dernier_message_at: new Date().toISOString(),
  archived_by_parent: false,
  archived_by_enseignant: false,
};

const messageFixture = {
  id: '00000000-0000-4000-a000-000000000066',
  conversation_id: conversation.id,
  expediteur_id: conversation.parent_id,
  contenu: 'Bonjour, je voudrais savoir comment va mon fils en classe.',
  lu: false,
  created_at: new Date().toISOString(),
};
```

Export them alongside existing fixtures.

- [ ] **Step 3: Create empty router**

```javascript
// backend/src/domains/06-messagerie/messagerie.routes.js
'use strict';

const express = require('express');
const router  = express.Router();

module.exports = router;
```

- [ ] **Step 4: Create test file using shared helpers**

```javascript
// backend/tests/domains/messagerie.routes.test.js
'use strict';

const request = require('supertest');
const { getDB } = require('../../src/infrastructure/database/pool');
const { createTestApp, defaultSession } = require('../helpers/testApp');
const { createMockDB, mockQuery, IDS } = require('../helpers/mockKnex');
const { conversation, messageFixture } = require('../helpers/fixtures');
const router = require('../../src/domains/06-messagerie/messagerie.routes');

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  enqueuerNotification: jest.fn().mockResolvedValue({ id: 'notif-001' }),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));

const { enqueuerNotification } = require('../../src/infrastructure/queue/bullmq');
const app = createTestApp(router);

let db;

beforeEach(() => {
  jest.clearAllMocks();
  db = createMockDB();
  getDB.mockReturnValue(db);
});

describe('Messagerie Routes', () => {
  // Tests go here (following steps)
});
```

- [ ] **Step 5: Commit skeleton**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js backend/tests/helpers/mockKnex.js backend/tests/helpers/fixtures.js
git commit -m "chore: scaffold messagerie route + test files, extend shared helpers"
```

---

### Task 3: POST /conversations — create/upsert conversation

**Files:**
- Modify: `backend/tests/domains/messagerie.routes.test.js`
- Modify: `backend/src/domains/06-messagerie/messagerie.routes.js`

- [ ] **Step 1: Write failing test — create conversation**

Add inside `describe('Messagerie Routes')`:

```javascript
describe('POST /conversations', () => {
  it('crée une conversation si elle n\'existe pas', async () => {
    // Mock: affectation check returns valid link
    const chain = db();
    chain.first.mockResolvedValueOnce({ id: IDS.enseignantRow }); // enseignant lookup
    chain.first.mockResolvedValueOnce({ id: IDS.classe });         // affectation check
    chain.first.mockResolvedValueOnce(null);                       // no existing conversation
    chain.returning.mockResolvedValueOnce([conversationRow]);       // insert returns new conv

    const res = await request(app)
      .post('/conversations')
      .send({
        parent_id: IDS.parent,
        enseignant_id: IDS.enseignant,
        eleve_id: IDS.eleve,
      })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.id).toBe(IDS.conversation);
  });

  it('retourne la conversation existante si le triplet existe', async () => {
    const chain = db();
    chain.first.mockResolvedValueOnce({ id: IDS.enseignantRow });
    chain.first.mockResolvedValueOnce({ id: IDS.classe });
    chain.first.mockResolvedValueOnce(conversationRow); // existing conversation

    const res = await request(app)
      .post('/conversations')
      .send({
        parent_id: IDS.parent,
        enseignant_id: IDS.enseignant,
        eleve_id: IDS.eleve,
      })
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.id).toBe(IDS.conversation);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose`
Expected: FAIL — no route handler defined

- [ ] **Step 3: Implement POST /conversations**

Add to `messagerie.routes.js`:

```javascript
'use strict';

const express = require('express');
const router  = express.Router();
const { z }   = require('zod');
const { getDB } = require('../../infrastructure/database/pool');
const { authentifier } = require('../../middleware/auth.middleware');
const { exigerPermission, isolerEtablissement } = require('../../middleware/permission.middleware');
const { valider } = require('../../middleware/validate.middleware');
const { ok, cree, paginee, getPagination } = require('../../utils/reponse');
const ApiError = require('../../utils/ApiError');
const { enqueuerNotification } = require('../../infrastructure/queue/bullmq');
const logger = require('../../utils/logger');
const { rateLimiter } = require('../../middleware/rateLimiter');

// Rate limit spécifique messagerie: 30 messages/min par utilisateur
const msgRateLimit = rateLimiter({ windowMs: 60000, max: 30 });

const auth  = authentifier;
const isoler = isolerEtablissement;
const perm  = exigerPermission;

// ── Schémas Zod ─────────────────────────────────────

const schemaCreerConversation = z.object({
  parent_id:     z.string().uuid(),
  enseignant_id: z.string().uuid(),
  eleve_id:      z.string().uuid(),
});

// ── POST /conversations — créer ou récupérer un fil ──

router.post('/conversations',
  auth, isoler, perm('messagerie.envoyer'),
  valider(schemaCreerConversation),
  async (req, res, next) => {
    try {
      const db = getDB();
      const { parent_id, enseignant_id, eleve_id } = req.body;
      const etab = req.etablissement_id;

      // Vérifier que l'enseignant (utilisateur) a bien cet élève
      // Join: utilisateurs → enseignants → affectations → inscriptions
      const enseignantRow = await db('enseignants')
        .where({ utilisateur_id: enseignant_id, etablissement_id: etab })
        .whereNull('deleted_at')
        .first('id');

      if (!enseignantRow) throw ApiError.nonTrouve('Enseignant introuvable');

      const affectation = await db('affectations_enseignants as ae')
        .join('inscriptions as i', 'i.classe_id', 'ae.classe_id')
        .where({ 'ae.enseignant_id': enseignantRow.id, 'i.eleve_id': eleve_id })
        .whereNull('ae.deleted_at')
        .whereNull('i.deleted_at')
        .first('ae.id');

      if (!affectation) throw ApiError.interdit('Cet enseignant n\'a pas cet élève dans ses classes');

      // Upsert : chercher existante
      const existante = await db('conversations')
        .where({ parent_id, enseignant_id, eleve_id, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (existante) return ok(res, existante);

      const [nouvelle] = await db('conversations')
        .insert({
          etablissement_id: etab,
          parent_id,
          enseignant_id,
          eleve_id,
        })
        .returning('*');

      return cree(res, nouvelle);
    } catch (err) { next(err); }
  }
);

module.exports = router;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose`
Expected: 2 tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js
git commit -m "feat(messagerie): POST /conversations — create/upsert with affectation check"
```

---

### Task 4: GET /conversations — list conversations

**Files:**
- Modify: `backend/tests/domains/messagerie.routes.test.js`
- Modify: `backend/src/domains/06-messagerie/messagerie.routes.js`

- [ ] **Step 1: Write failing test**

```javascript
describe('GET /conversations', () => {
  it('retourne les conversations de l\'utilisateur paginées', async () => {
    // Set session as parent
    const chain = db();
    chain.select.mockReturnThis();
    chain.clone.mockReturnValue({ count: jest.fn().mockResolvedValue([{ count: '1' }]) });
    chain.orderBy.mockReturnThis();
    chain.limit.mockReturnThis();
    chain.offset.mockResolvedValue([conversationRow]);

    const res = await request(app)
      .get('/conversations?page=1&limite=20')
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose -t "GET /conversations"`

- [ ] **Step 3: Implement GET /conversations**

Add to `messagerie.routes.js` before `module.exports`:

```javascript
// ── GET /conversations — liste mes conversations ──

router.get('/conversations',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const etab = req.etablissement_id;
      const userId = req.session.utilisateur_id;
      const roles = req.session.roles;
      const { page, limite, offset } = getPagination(req.query);

      let query = db('conversations as c')
        .join('utilisateurs as p', 'p.id', 'c.parent_id')
        .join('utilisateurs as e', 'e.id', 'c.enseignant_id')
        .join('eleves as el', 'el.id', 'c.eleve_id')
        .where('c.etablissement_id', etab)
        .whereNull('c.deleted_at')
        .select(
          'c.*',
          'p.nom as parent_nom', 'p.prenom as parent_prenom',
          'e.nom as enseignant_nom', 'e.prenom as enseignant_prenom',
          'el.nom as eleve_nom', 'el.prenom as eleve_prenom'
        );

      // Filtrage par rôle
      const estSuperviseur = roles.some(r => ['directeur', 'censeur', 'super_admin'].includes(r));
      if (!estSuperviseur) {
        query = query.andWhere(function() {
          this.where('c.parent_id', userId).orWhere('c.enseignant_id', userId);
        });

        // Masquer les conversations archivées par cet utilisateur
        const estParent = roles.includes('parent');
        if (estParent) {
          query = query.andWhere('c.archived_by_parent', false);
        } else {
          query = query.andWhere('c.archived_by_enseignant', false);
        }
      }

      // Sous-requête : nombre de non-lus par conversation
      query = query.select(
        db.raw(`(SELECT COUNT(*) FROM messages m
                 WHERE m.conversation_id = c.id
                   AND m.expediteur_id != ?
                   AND m.lu = FALSE
                   AND m.deleted_at IS NULL) as non_lus`, [userId])
      );

      const countResult = await query.clone().clearSelect().clearOrder().count('c.id as count').first();
      const total = parseInt(countResult?.count || '0');

      const rows = await query
        .orderBy('c.dernier_message_at', 'desc')
        .limit(limite)
        .offset(offset);

      return paginee(res, rows, { total, page, limite });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 4: Run test — verify PASS**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose -t "GET /conversations"`

- [ ] **Step 5: Commit**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js
git commit -m "feat(messagerie): GET /conversations — paginated list with non-lu count"
```

---

### Task 5: POST /conversations/:id/messages — send message

**Files:**
- Modify: `backend/tests/domains/messagerie.routes.test.js`
- Modify: `backend/src/domains/06-messagerie/messagerie.routes.js`

- [ ] **Step 1: Write failing test**

```javascript
describe('POST /conversations/:id/messages', () => {
  it('envoie un message et notifie le destinataire', async () => {
    const chain = db();
    // conversation lookup
    chain.first.mockResolvedValueOnce(conversationRow);
    // insert message
    chain.returning.mockResolvedValueOnce([messageRow]);
    // update dernier_message_at
    chain.update.mockResolvedValueOnce(1);
    // notification prefs lookup
    chain.first.mockResolvedValueOnce({ canal_prefere: 'sms', utilisateur_id: IDS.enseignant });

    const res = await request(app)
      .post(`/conversations/${IDS.conversation}/messages`)
      .send({ contenu: 'Bonjour, comment va mon fils ?' })
      .expect(201);

    expect(res.body.succes).toBe(true);
    expect(res.body.data.contenu).toBeDefined();
    expect(enqueuerNotification).toHaveBeenCalled();
  });

  it('refuse si l\'utilisateur n\'est pas participant', async () => {
    const convAutre = { ...conversationRow, parent_id: 'autre-id', enseignant_id: 'autre-id-2' };
    const chain = db();
    chain.first.mockResolvedValueOnce(convAutre);

    // Session user is neither parent_id nor enseignant_id and not superviseur
    const origSession = { ...defaultSession, roles: ['parent'] };
    require('../../src/middleware/auth.middleware').authentifier.mockImplementationOnce((req, res, next) => {
      req.session = origSession;
      req.etablissement_id = origSession.etablissement_id;
      next();
    });

    const res = await request(app)
      .post(`/conversations/${IDS.conversation}/messages`)
      .send({ contenu: 'Message non autorisé' })
      .expect(403);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose -t "POST /conversations/:id/messages"`

- [ ] **Step 3: Implement POST /conversations/:id/messages**

Add to `messagerie.routes.js`:

```javascript
const schemaEnvoyerMessage = z.object({
  contenu: z.string().min(1).max(2000),
});

// ── POST /conversations/:id/messages — envoyer un message ──

router.post('/conversations/:id/messages',
  auth, isoler, perm('messagerie.envoyer'), msgRateLimit,
  valider(schemaEnvoyerMessage),
  async (req, res, next) => {
    try {
      const db = getDB();
      const convId = req.params.id;
      const etab = req.etablissement_id;
      const userId = req.session.utilisateur_id;
      const roles = req.session.roles;

      // Charger la conversation
      const conv = await db('conversations')
        .where({ id: convId, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (!conv) throw ApiError.nonTrouve('Conversation introuvable');

      // Vérifier que l'utilisateur est participant ou superviseur
      const estParticipant = conv.parent_id === userId || conv.enseignant_id === userId;
      const estSuperviseur = roles.some(r => ['directeur', 'censeur', 'super_admin'].includes(r));

      if (!estParticipant && !estSuperviseur) {
        throw ApiError.interdit('Vous n\'êtes pas participant de cette conversation');
      }

      // Insérer le message
      const [message] = await db('messages')
        .insert({
          conversation_id: convId,
          etablissement_id: etab,
          expediteur_id: userId,
          contenu: req.body.contenu,
        })
        .returning('*');

      // Mettre à jour dernier_message_at
      await db('conversations')
        .where({ id: convId })
        .update({ dernier_message_at: db.raw('NOW()'), updated_at: db.raw('NOW()') });

      // Déterminer le destinataire et notifier
      const destinataireId = estParticipant
        ? (conv.parent_id === userId ? conv.enseignant_id : conv.parent_id)
        : null; // superviseur — pas de notif ciblée

      if (destinataireId) {
        const prefs = await db('notifications_preferences')
          .where({ utilisateur_id: destinataireId })
          .first('canal_prefere');

        await enqueuerNotification({
          type_notif: 'nouveau_message',
          destinataire_id: destinataireId,
          etablissement_id: etab,
          conversation_id: convId,
          expediteur_nom: req.session.nom_complet,
          eleve_id: conv.eleve_id,
          canal: prefs?.canal_prefere || 'sms',
        }).catch(err => {
          // Non-bloquant — le message est envoyé même si la notif échoue
          logger.error('Erreur notification messagerie', { error: err.message });
        });
      }

      return cree(res, message);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 4: Run test — verify PASS**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose -t "POST /conversations/:id/messages"`

- [ ] **Step 5: Commit**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js
git commit -m "feat(messagerie): POST /conversations/:id/messages — send + notify"
```

---

### Task 6: GET /conversations/:id/messages — list messages

**Files:**
- Modify: `backend/tests/domains/messagerie.routes.test.js`
- Modify: `backend/src/domains/06-messagerie/messagerie.routes.js`

- [ ] **Step 1: Write failing test**

```javascript
describe('GET /conversations/:id/messages', () => {
  it('retourne les messages paginés du fil', async () => {
    const chain = db();
    chain.first.mockResolvedValueOnce(conversationRow); // conv lookup
    chain.clone.mockReturnValue({ count: jest.fn().mockResolvedValue([{ count: '1' }]) });
    chain.offset.mockResolvedValue([messageRow]);

    const res = await request(app)
      .get(`/conversations/${IDS.conversation}/messages?page=1&limite=50`)
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify FAIL**

- [ ] **Step 3: Implement GET /conversations/:id/messages**

```javascript
// ── GET /conversations/:id/messages — messages du fil ──

router.get('/conversations/:id/messages',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const convId = req.params.id;
      const etab = req.etablissement_id;
      const userId = req.session.utilisateur_id;
      const roles = req.session.roles;

      const conv = await db('conversations')
        .where({ id: convId, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (!conv) throw ApiError.nonTrouve('Conversation introuvable');

      const estParticipant = conv.parent_id === userId || conv.enseignant_id === userId;
      const estSuperviseur = roles.some(r => ['directeur', 'censeur', 'super_admin'].includes(r));
      if (!estParticipant && !estSuperviseur) throw ApiError.interdit('Accès refusé');

      const { page, limite, offset } = getPagination(req.query);

      const query = db('messages as m')
        .join('utilisateurs as u', 'u.id', 'm.expediteur_id')
        .where({ 'm.conversation_id': convId })
        .whereNull('m.deleted_at')
        .select(
          'm.*',
          'u.nom as expediteur_nom',
          'u.prenom as expediteur_prenom'
        );

      const countResult = await query.clone().clearSelect().clearOrder().count('m.id as count').first();
      const total = parseInt(countResult?.count || '0');

      const rows = await query
        .orderBy('m.created_at', 'asc')
        .limit(limite)
        .offset(offset);

      return paginee(res, rows, { total, page, limite });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 4: Run test — verify PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js
git commit -m "feat(messagerie): GET /conversations/:id/messages — paginated thread"
```

---

### Task 7: PATCH /conversations/:id/lu + GET /conversations/non-lus + PATCH /archive

**Files:**
- Modify: `backend/tests/domains/messagerie.routes.test.js`
- Modify: `backend/src/domains/06-messagerie/messagerie.routes.js`

- [ ] **Step 1: Write failing tests**

```javascript
describe('PATCH /conversations/:id/lu', () => {
  it('marque les messages reçus comme lus', async () => {
    const chain = db();
    chain.first.mockResolvedValueOnce(conversationRow);
    chain.update.mockResolvedValueOnce(3); // 3 messages marked

    const res = await request(app)
      .patch(`/conversations/${IDS.conversation}/lu`)
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});

describe('GET /conversations/non-lus', () => {
  it('retourne le compteur de messages non lus', async () => {
    const chain = db();
    chain.first.mockResolvedValueOnce({ count: '5' });

    const res = await request(app)
      .get('/conversations/non-lus')
      .expect(200);

    expect(res.body.succes).toBe(true);
    expect(res.body.data).toHaveProperty('count');
  });
});

describe('PATCH /conversations/:id/archive', () => {
  it('archive la conversation pour l\'utilisateur', async () => {
    const chain = db();
    chain.first.mockResolvedValueOnce(conversationRow);
    chain.update.mockResolvedValueOnce(1);

    const res = await request(app)
      .patch(`/conversations/${IDS.conversation}/archive`)
      .expect(200);

    expect(res.body.succes).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests — verify FAIL**

- [ ] **Step 3: Implement all three endpoints**

**IMPORTANT: Route order matters.** In the final file, `GET /conversations/non-lus` MUST be placed BEFORE `GET /conversations/:id/messages` (from Task 6). When inserting this code, place it ABOVE the `:id` routes. Otherwise Express will match `non-lus` as an `:id` parameter.

```javascript
// ── GET /conversations/non-lus — compteur badge ──
// IMPORTANT: doit être AVANT la route :id pour éviter que 'non-lus' soit capturé comme :id

router.get('/conversations/non-lus',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const userId = req.session.utilisateur_id;
      const etab = req.etablissement_id;

      const result = await db('messages as m')
        .join('conversations as c', 'c.id', 'm.conversation_id')
        .where('c.etablissement_id', etab)
        .whereNull('c.deleted_at')
        .whereNull('m.deleted_at')
        .where('m.lu', false)
        .whereNot('m.expediteur_id', userId)
        .andWhere(function() {
          this.where('c.parent_id', userId).orWhere('c.enseignant_id', userId);
        })
        .count('m.id as count')
        .first();

      return ok(res, { count: parseInt(result?.count || '0') });
    } catch (err) { next(err); }
  }
);

// ── PATCH /conversations/:id/lu — marquer messages reçus comme lus ──

router.patch('/conversations/:id/lu',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const convId = req.params.id;
      const userId = req.session.utilisateur_id;
      const etab = req.etablissement_id;

      const conv = await db('conversations')
        .where({ id: convId, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (!conv) throw ApiError.nonTrouve('Conversation introuvable');

      const updated = await db('messages')
        .where({ conversation_id: convId, lu: false })
        .whereNot('expediteur_id', userId)
        .whereNull('deleted_at')
        .update({ lu: true, lu_at: db.raw('NOW()'), updated_at: db.raw('NOW()') });

      return ok(res, { messages_marques: updated });
    } catch (err) { next(err); }
  }
);

// ── PATCH /conversations/:id/archive — archiver/désarchiver ──

router.patch('/conversations/:id/archive',
  auth, isoler, perm('messagerie.voir'),
  async (req, res, next) => {
    try {
      const db = getDB();
      const convId = req.params.id;
      const userId = req.session.utilisateur_id;
      const etab = req.etablissement_id;
      const roles = req.session.roles;

      const conv = await db('conversations')
        .where({ id: convId, etablissement_id: etab })
        .whereNull('deleted_at')
        .first();

      if (!conv) throw ApiError.nonTrouve('Conversation introuvable');

      const estParent = conv.parent_id === userId;
      const estEnseignant = conv.enseignant_id === userId;
      if (!estParent && !estEnseignant) throw ApiError.interdit('Accès refusé');

      const champ = estParent ? 'archived_by_parent' : 'archived_by_enseignant';
      const nouvelleValeur = !conv[champ]; // toggle

      await db('conversations')
        .where({ id: convId })
        .update({ [champ]: nouvelleValeur, updated_at: db.raw('NOW()') });

      return ok(res, { archived: nouvelleValeur });
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 4: Run tests — verify PASS**

Run: `cd backend && npx jest tests/domains/messagerie.routes.test.js --verbose`

- [ ] **Step 5: Commit**

```bash
git add backend/src/domains/06-messagerie/messagerie.routes.js backend/tests/domains/messagerie.routes.test.js
git commit -m "feat(messagerie): PATCH lu, GET non-lus, PATCH archive endpoints"
```

---

### Task 8: Add helper endpoints for the new-conversation modal

The "New conversation" modal in the dashboard needs two endpoints that don't exist yet:
- `GET /eleves/:id/enseignants` — list teachers of a student (via affectations)
- `GET /eleves/:id/parents` — list parents of a student (via parents_eleves)

**Files:**
- Modify: `backend/src/domains/02-acteurs/eleves/eleves.routes.js`
- Modify: `backend/tests/domains/eleves.routes.test.js`

- [ ] **Step 1: Add GET /eleves/:id/enseignants**

```javascript
// In eleves.routes.js — returns teachers linked to this student via inscriptions → affectations

router.get('/eleves/:id/enseignants',
  auth, isoler,
  async (req, res, next) => {
    try {
      const db = getDB();
      const eleveId = req.params.id;
      const etab = req.etablissement_id;

      const rows = await db('inscriptions as i')
        .join('affectations_enseignants as ae', 'ae.classe_id', 'i.classe_id')
        .join('enseignants as ens', 'ens.id', 'ae.enseignant_id')
        .join('utilisateurs as u', 'u.id', 'ens.utilisateur_id')
        .join('matieres as mat', 'mat.id', 'ae.matiere_id')
        .where({ 'i.eleve_id': eleveId, 'i.etablissement_id': etab })
        .whereNull('i.deleted_at')
        .whereNull('ae.deleted_at')
        .select('u.id as utilisateur_id', 'u.nom', 'u.prenom', 'mat.nom as matiere')
        .groupBy('u.id', 'u.nom', 'u.prenom', 'mat.nom');

      return ok(res, rows);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 2: Add GET /eleves/:id/parents**

```javascript
// In eleves.routes.js — returns parents linked to this student

router.get('/eleves/:id/parents',
  auth, isoler,
  async (req, res, next) => {
    try {
      const db = getDB();
      const eleveId = req.params.id;
      const etab = req.etablissement_id;

      const rows = await db('parents_eleves as pe')
        .join('utilisateurs as u', 'u.id', 'pe.parent_id')
        .where({ 'pe.eleve_id': eleveId })
        .where('u.etablissement_id', etab)
        .whereNull('u.deleted_at')
        .select('u.id', 'u.nom', 'u.prenom', 'pe.lien', 'pe.est_contact_principal');

      return ok(res, rows);
    } catch (err) { next(err); }
  }
);
```

- [ ] **Step 3: Add tests for both endpoints**

- [ ] **Step 4: Commit**

```bash
git add backend/src/domains/02-acteurs/eleves/eleves.routes.js backend/tests/domains/eleves.routes.test.js
git commit -m "feat(eleves): add GET /eleves/:id/enseignants and /parents for messagerie modal"
```

---

### Task 9: Mount router in app.js + run all tests

**Files:**
- Modify: `backend/src/app.js`

- [ ] **Step 1: Mount messagerie router in app.js**

Add import alongside the other domain routers:
```javascript
const messagerieRouter      = require('./domains/06-messagerie/messagerie.routes');
```

Add mount alongside the other `app.use(PREFIX, ...)`:
```javascript
app.use(PREFIX, messagerieRouter);
```

- [ ] **Step 2: Run full test suite**

Run: `cd backend && npm test`
Expected: All existing 60 tests + ~10 new messagerie tests PASS

- [ ] **Step 3: Run lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add backend/src/app.js
git commit -m "feat(messagerie): mount router in app.js"
```

---

## Chunk 3: Dashboard UI

### Task 9: Add messagerie to sidebar + page container + router

**Files:**
- Modify: `dashboard/index.html` (admin portal)
- Modify: `dashboard/enseignant.html` (teacher portal)
- Modify: `dashboard/parent.html` (parent portal)
- Modify: `dashboard/js/router.js`
- Modify: `dashboard/js/api.js` — add `Api.patch` method

- [ ] **Step 1: Add `Api.patch` to api.js**

In `dashboard/js/api.js`, add alongside `get`, `post`, `put`, `del`:
```javascript
patch: function(path, body) { return this.request('PATCH', path, body); },
```

- [ ] **Step 2: Add sidebar entry + page container in ALL 3 HTML files**

Add the sidebar entry and page container to `dashboard/index.html`, `dashboard/enseignant.html`, AND `dashboard/parent.html`. Find the nav section in each file. Pattern:

```html
<a class="nav-item" data-page="messagerie" onclick="goto('messagerie')">
  <span class="nav-ico">💬</span>Messagerie
  <span class="nav-badge" id="nav-badge-messagerie" style="display:none">0</span>
</a>
```

Add page container alongside other `<div class="page">` elements:

```html
<div class="page" id="page-messagerie">
  <div class="ph">
    <div><div class="ph-titre">Messagerie</div><div class="ph-sous">Conversations avec les enseignants et parents</div></div>
    <button class="btn btn-p" id="msg-btn-nouvelle" onclick="PageMessagerie.nouvelleConversation()">+ Nouvelle conversation</button>
  </div>
  <div id="msg-container">
    <!-- Vue liste ou vue chat, remplie par JS -->
    <div id="msg-liste"></div>
    <div id="msg-chat" style="display:none"></div>
  </div>
</div>
```

Also add `<script src="js/pages/messagerie.js"></script>` before the closing `</body>` in all 3 HTML files.

- [ ] **Step 3: Add to router.js TITRES**

In `dashboard/js/router.js`, add to `TITRES`:
```javascript
messagerie: 'Messagerie',
```

- [ ] **Step 4: Commit**

```bash
git add dashboard/index.html dashboard/enseignant.html dashboard/parent.html dashboard/js/router.js dashboard/js/api.js
git commit -m "feat(dashboard): add messagerie sidebar, page container, Api.patch in all portals"
```

---

### Task 10: Add chat CSS styles

**Files:**
- Modify: `dashboard/css/style.css`

- [ ] **Step 1: Add messagerie styles at end of style.css**

```css
/* ── Messagerie ─────────────────────────────────────── */

.msg-list          { display:flex; flex-direction:column; gap:4px; }
.msg-item          { display:flex; align-items:center; gap:12px; padding:12px 16px;
                     border-radius:8px; cursor:pointer; transition:background .15s; }
.msg-item:hover    { background:var(--vert-bg); }
.msg-item.non-lu   { background:#f0f7f2; font-weight:600; }
.msg-avatar        { width:40px; height:40px; border-radius:50%; background:var(--vert);
                     color:#fff; display:flex; align-items:center; justify-content:center;
                     font-weight:700; font-size:14px; flex-shrink:0; }
.msg-info          { flex:1; min-width:0; }
.msg-nom           { font-size:14px; color:var(--g800); }
.msg-eleve         { font-size:12px; color:var(--g400); }
.msg-apercu        { font-size:13px; color:var(--g500); white-space:nowrap;
                     overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
.msg-meta          { text-align:right; flex-shrink:0; }
.msg-date          { font-size:11px; color:var(--g400); }
.msg-badge-nl      { display:inline-block; background:var(--orange); color:#fff;
                     font-size:11px; font-weight:700; border-radius:10px;
                     padding:1px 7px; margin-top:4px; }

/* Chat view */
.msg-chat-header   { display:flex; align-items:center; gap:12px; padding:12px 16px;
                     border-bottom:1px solid var(--g100); }
.msg-chat-back     { cursor:pointer; font-size:20px; color:var(--vert); }
.msg-chat-body     { flex:1; overflow-y:auto; padding:16px; display:flex;
                     flex-direction:column; gap:8px; max-height:60vh; }
.msg-bulle         { max-width:70%; padding:10px 14px; border-radius:16px;
                     font-size:14px; line-height:1.4; word-wrap:break-word; }
.msg-bulle.moi     { align-self:flex-end; background:var(--vert); color:#fff;
                     border-bottom-right-radius:4px; }
.msg-bulle.autre   { align-self:flex-start; background:var(--g100); color:var(--g800);
                     border-bottom-left-radius:4px; }
.msg-bulle-date    { font-size:10px; margin-top:2px; opacity:.6; }
.msg-chat-input    { display:flex; gap:8px; padding:12px 16px; border-top:1px solid var(--g100); }
.msg-chat-input input { flex:1; }
.msg-chat-input .btn  { flex-shrink:0; }
.msg-vide          { text-align:center; padding:40px; color:var(--g400); }
```

- [ ] **Step 2: Commit**

```bash
git add dashboard/css/style.css
git commit -m "feat(dashboard): add messagerie chat CSS styles"
```

---

### Task 11: Implement messagerie.js page logic

**Files:**
- Create: `dashboard/js/pages/messagerie.js`

- [ ] **Step 1: Create messagerie.js**

```javascript
// dashboard/js/pages/messagerie.js
'use strict';

var PageMessagerie = {
  _conversations: [],
  _convActive: null,
  _messages: [],
  _pollTimer: null,

  // ── Init ──────────────────────────────────────────
  init: function() {
    this._convActive = null;
    document.getElementById('msg-liste').style.display = '';
    document.getElementById('msg-chat').style.display = 'none';
    this.chargerConversations();
    this._startBadgePoll();
  },

  destroy: function() {
    if (this._pollTimer) clearInterval(this._pollTimer);
  },

  // ── Conversations list ────────────────────────────
  chargerConversations: async function() {
    var liste = document.getElementById('msg-liste');
    if (!liste) return;
    liste.innerHTML = '<div class="msg-vide">Chargement…</div>';

    try {
      var res = await Api.get('/conversations', { page: 1, limite: 50 });
      this._conversations = res.data || [];
      this._renderListe(this._conversations);
    } catch (e) {
      liste.innerHTML = '<div class="msg-vide">Impossible de charger les conversations</div>';
    }
  },

  _renderListe: function(convs) {
    var liste = document.getElementById('msg-liste');
    if (!convs.length) {
      liste.innerHTML = '<div class="msg-vide">Aucune conversation pour le moment.<br>Cliquez sur "+ Nouvelle conversation" pour commencer.</div>';
      return;
    }

    var user = Auth.getUser();
    var userId = user && user.id;

    liste.innerHTML = '<div class="msg-list">' + convs.map(function(c) {
      var estParent = c.parent_id === userId;
      var nom = estParent
        ? (c.enseignant_prenom + ' ' + c.enseignant_nom)
        : (c.parent_prenom + ' ' + c.parent_nom);
      var initiales = nom.split(' ').map(function(n) { return n[0]; }).join('').slice(0, 2);
      var eleve = (c.eleve_prenom || '') + ' ' + (c.eleve_nom || '');
      var nonLu = parseInt(c.non_lus || 0);

      return '<div class="msg-item' + (nonLu > 0 ? ' non-lu' : '') + '" onclick="PageMessagerie.ouvrirChat(\'' + c.id + '\')">' +
        '<div class="msg-avatar">' + initiales + '</div>' +
        '<div class="msg-info">' +
          '<div class="msg-nom">' + nom + '</div>' +
          '<div class="msg-eleve">Élève : ' + eleve + '</div>' +
        '</div>' +
        '<div class="msg-meta">' +
          '<div class="msg-date">' + PageMessagerie._fmtDate(c.dernier_message_at) + '</div>' +
          (nonLu > 0 ? '<div class="msg-badge-nl">' + nonLu + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  },

  // ── Chat view ─────────────────────────────────────
  ouvrirChat: async function(convId) {
    this._convActive = this._conversations.find(function(c) { return c.id === convId; });
    if (!this._convActive) return;

    document.getElementById('msg-liste').style.display = 'none';
    var chatEl = document.getElementById('msg-chat');
    chatEl.style.display = '';

    var user = Auth.getUser();
    var estParent = this._convActive.parent_id === (user && user.id);
    var correspondant = estParent
      ? (this._convActive.enseignant_prenom + ' ' + this._convActive.enseignant_nom)
      : (this._convActive.parent_prenom + ' ' + this._convActive.parent_nom);
    var eleve = (this._convActive.eleve_prenom || '') + ' ' + (this._convActive.eleve_nom || '');

    chatEl.innerHTML =
      '<div class="msg-chat-header">' +
        '<span class="msg-chat-back" onclick="PageMessagerie.retourListe()">←</span>' +
        '<div><div style="font-weight:600">' + correspondant + '</div>' +
        '<div style="font-size:12px;color:var(--g400)">Élève : ' + eleve + '</div></div>' +
      '</div>' +
      '<div class="msg-chat-body" id="msg-chat-body">Chargement…</div>' +
      '<div class="msg-chat-input">' +
        '<input type="text" class="fi" id="msg-input" placeholder="Votre message…" maxlength="2000" onkeydown="if(event.key===\'Enter\')PageMessagerie.envoyer()">' +
        '<button class="btn btn-p" onclick="PageMessagerie.envoyer()">Envoyer</button>' +
      '</div>';

    // Marquer comme lu
    Api.patch('/conversations/' + convId + '/lu').catch(function() {});

    await this._chargerMessages(convId);
  },

  _chargerMessages: async function(convId) {
    try {
      var res = await Api.get('/conversations/' + convId + '/messages', { page: 1, limite: 100 });
      this._messages = res.data || [];
      this._renderMessages();
    } catch (e) {
      document.getElementById('msg-chat-body').innerHTML = '<div class="msg-vide">Erreur chargement</div>';
    }
  },

  _renderMessages: function() {
    var body = document.getElementById('msg-chat-body');
    if (!body) return;

    if (!this._messages.length) {
      body.innerHTML = '<div class="msg-vide">Aucun message. Commencez la conversation !</div>';
      return;
    }

    var user = Auth.getUser();
    var userId = user && user.id;

    body.innerHTML = this._messages.map(function(m) {
      var estMoi = m.expediteur_id === userId;
      var nom = (m.expediteur_prenom || '') + ' ' + (m.expediteur_nom || '');
      return '<div class="msg-bulle ' + (estMoi ? 'moi' : 'autre') + '">' +
        (!estMoi ? '<div style="font-size:11px;font-weight:600;margin-bottom:2px">' + nom + '</div>' : '') +
        m.contenu +
        '<div class="msg-bulle-date">' + PageMessagerie._fmtHeure(m.created_at) + '</div>' +
      '</div>';
    }).join('');

    body.scrollTop = body.scrollHeight;
  },

  // ── Send message ──────────────────────────────────
  envoyer: async function() {
    var input = document.getElementById('msg-input');
    if (!input || !input.value.trim() || !this._convActive) return;

    var contenu = input.value.trim();
    input.value = '';
    input.disabled = true;

    try {
      await Api.post('/conversations/' + this._convActive.id + '/messages', { contenu: contenu });
      await this._chargerMessages(this._convActive.id);
    } catch (e) {
      toast('Erreur envoi : ' + (e.message || 'réseau'), 'error');
    } finally {
      input.disabled = false;
      input.focus();
    }
  },

  // ── New conversation modal ────────────────────────
  nouvelleConversation: async function() {
    var user = Auth.getUser();
    var roles = (user && user.roles) || [];
    var estParent = roles.includes('parent');

    var html = '<div class="mf">';
    if (estParent) {
      html += '<div class="fg"><label class="fl">Enseignant</label>' +
              '<select class="fi" id="msg-sel-ens"><option value="">Chargement…</option></select></div>' +
              '<div class="fg"><label class="fl">Enfant</label>' +
              '<select class="fi" id="msg-sel-eleve"><option value="">Chargement…</option></select></div>';
    } else {
      html += '<div class="fg"><label class="fl">Classe</label>' +
              '<select class="fi" id="msg-sel-classe"><option value="">Chargement…</option></select></div>' +
              '<div class="fg"><label class="fl">Élève</label>' +
              '<select class="fi" id="msg-sel-eleve"><option value="">— Choisir une classe —</option></select></div>' +
              '<div class="fg"><label class="fl">Parent</label>' +
              '<select class="fi" id="msg-sel-parent"><option value="">— Choisir un élève —</option></select></div>';
    }
    html += '</div>';

    openModal('Nouvelle conversation', html, function() {
      PageMessagerie._creerConversation(estParent);
    });

    // Charger les données
    if (estParent) {
      PageMessagerie._chargerSelectsParent();
    } else {
      PageMessagerie._chargerSelectsEnseignant();
    }
  },

  _chargerSelectsParent: async function() {
    try {
      var res = await Api.get('/parents/moi/enfants');
      var enfants = res.data || [];
      var selEleve = document.getElementById('msg-sel-eleve');
      selEleve.innerHTML = '<option value="">— Choisir —</option>' +
        enfants.map(function(e) { return '<option value="' + e.id + '">' + e.prenom + ' ' + e.nom + '</option>'; }).join('');

      // TODO: charger enseignants de l'enfant sélectionné
      selEleve.onchange = async function() {
        var eleveId = selEleve.value;
        if (!eleveId) return;
        try {
          var r = await Api.get('/eleves/' + eleveId + '/enseignants');
          var enseignants = r.data || [];
          var selEns = document.getElementById('msg-sel-ens');
          selEns.innerHTML = '<option value="">— Choisir —</option>' +
            enseignants.map(function(e) { return '<option value="' + e.utilisateur_id + '">' + e.prenom + ' ' + e.nom + ' (' + e.matiere + ')</option>'; }).join('');
        } catch (e) { /* silent */ }
      };
    } catch (e) { /* silent */ }
  },

  _chargerSelectsEnseignant: async function() {
    try {
      var res = await Api.get('/enseignants/moi/classes');
      var classes = res.data || [];
      var selClasse = document.getElementById('msg-sel-classe');
      selClasse.innerHTML = '<option value="">— Choisir —</option>' +
        classes.map(function(c) { return '<option value="' + c.id + '">' + c.nom + '</option>'; }).join('');

      selClasse.onchange = async function() {
        var classeId = selClasse.value;
        if (!classeId) return;
        try {
          var r = await Api.get('/eleves', { classe_id: classeId });
          var eleves = r.data || [];
          var selEleve = document.getElementById('msg-sel-eleve');
          selEleve.innerHTML = '<option value="">— Choisir —</option>' +
            eleves.map(function(e) { return '<option value="' + e.id + '">' + e.prenom + ' ' + e.nom + '</option>'; }).join('');

          selEleve.onchange = async function() {
            var eleveId = selEleve.value;
            if (!eleveId) return;
            try {
              var r2 = await Api.get('/eleves/' + eleveId + '/parents');
              var parents = r2.data || [];
              var selParent = document.getElementById('msg-sel-parent');
              selParent.innerHTML = '<option value="">— Choisir —</option>' +
                parents.map(function(p) { return '<option value="' + p.id + '">' + p.prenom + ' ' + p.nom + ' (' + p.lien + ')</option>'; }).join('');
            } catch (e) { /* silent */ }
          };
        } catch (e) { /* silent */ }
      };
    } catch (e) { /* silent */ }
  },

  _creerConversation: async function(estParent) {
    var parentId, enseignantId, eleveId;

    if (estParent) {
      var user = Auth.getUser();
      parentId = user && user.id;
      enseignantId = document.getElementById('msg-sel-ens').value;
      eleveId = document.getElementById('msg-sel-eleve').value;
    } else {
      var user = Auth.getUser();
      enseignantId = user && user.id;
      parentId = document.getElementById('msg-sel-parent').value;
      eleveId = document.getElementById('msg-sel-eleve').value;
    }

    if (!parentId || !enseignantId || !eleveId) {
      toast('Veuillez remplir tous les champs', 'warning');
      return;
    }

    try {
      var res = await Api.post('/conversations', {
        parent_id: parentId,
        enseignant_id: enseignantId,
        eleve_id: eleveId,
      });
      closeModal();
      this.chargerConversations();
      if (res.data && res.data.id) this.ouvrirChat(res.data.id);
    } catch (e) {
      toast('Erreur : ' + (e.message || 'réseau'), 'error');
    }
  },

  // ── Navigation ────────────────────────────────────
  retourListe: function() {
    this._convActive = null;
    document.getElementById('msg-chat').style.display = 'none';
    document.getElementById('msg-liste').style.display = '';
    this.chargerConversations();
  },

  // ── Badge polling ─────────────────────────────────
  _startBadgePoll: function() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._updateBadge();
    this._pollTimer = setInterval(function() { PageMessagerie._updateBadge(); }, 30000);
  },

  _updateBadge: async function() {
    try {
      var res = await Api.get('/conversations/non-lus');
      var count = (res.data && res.data.count) || 0;
      var badge = document.getElementById('nav-badge-messagerie');
      if (badge) {
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = count > 0 ? '' : 'none';
      }
    } catch (e) { /* silent */ }
  },

  // ── Helpers ───────────────────────────────────────
  _fmtDate: function(d) {
    if (!d) return '';
    var dt = new Date(d);
    var now = new Date();
    if (dt.toDateString() === now.toDateString()) {
      return ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
    }
    return ('0' + dt.getDate()).slice(-2) + '/' + ('0' + (dt.getMonth() + 1)).slice(-2);
  },

  _fmtHeure: function(d) {
    if (!d) return '';
    var dt = new Date(d);
    return ('0' + dt.getDate()).slice(-2) + '/' + ('0' + (dt.getMonth() + 1)).slice(-2) +
           ' ' + ('0' + dt.getHours()).slice(-2) + ':' + ('0' + dt.getMinutes()).slice(-2);
  },
};

PAGE_HOOKS.messagerie = function() { PageMessagerie.init(); };
```

- [ ] **Step 2: Test manually with `npx serve dashboard -l 3001`**

Open browser, log in, click "Messagerie" in sidebar. Verify:
- Page loads with empty state message
- "Nouvelle conversation" button opens modal
- Badge shows in sidebar

- [ ] **Step 3: Commit**

```bash
git add dashboard/js/pages/messagerie.js
git commit -m "feat(dashboard): messagerie page — conversation list, chat view, new conversation modal"
```

---

### Task 12: Integrate messagerie badge into notifs.js

**Files:**
- Modify: `dashboard/js/notifs.js`

- [ ] **Step 1: Add messages_recus category**

In `notifs.js`, add to `_labels`:
```javascript
messages_recus: { icone: '💬', label: 'Messages reçus' },
```

- [ ] **Step 2: Update badge to include message count**

At the end of `Notifs._charger`, after the existing badge update, add a call to update the messagerie sidebar badge:
```javascript
// Also update messagerie badge
Api.get('/conversations/non-lus').then(function(res) {
  var count = (res.data && res.data.count) || 0;
  var badge = document.getElementById('nav-badge-messagerie');
  if (badge) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = count > 0 ? '' : 'none';
  }
}).catch(function() {});
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/js/notifs.js
git commit -m "feat(dashboard): integrate messagerie badge into notification polling"
```

---

## Chunk 4: Mobile Screens

### Task 13: Add SQLite tables for offline messaging

**Files:**
- Modify: `mobile/src/services/storage/database.ts`

- [ ] **Step 1: Add tables to SQLite schema initialization**

Find the `initDB()` or `createTables()` function in `database.ts`. Add:

```typescript
await db.execAsync(`
  CREATE TABLE IF NOT EXISTS conversations_locaux (
    id TEXT PRIMARY KEY,
    etablissement_id TEXT NOT NULL,
    parent_id TEXT NOT NULL,
    enseignant_id TEXT NOT NULL,
    eleve_id TEXT NOT NULL,
    dernier_message_at TEXT,
    parent_nom TEXT,
    parent_prenom TEXT,
    enseignant_nom TEXT,
    enseignant_prenom TEXT,
    eleve_nom TEXT,
    eleve_prenom TEXT,
    non_lus INTEGER DEFAULT 0,
    synced_at TEXT
  );

  CREATE TABLE IF NOT EXISTS messages_locaux (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    expediteur_id TEXT NOT NULL,
    contenu TEXT NOT NULL,
    lu INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    expediteur_nom TEXT,
    expediteur_prenom TEXT,
    pending_sync INTEGER DEFAULT 0,
    synced_at TEXT
  );
`);
```

- [ ] **Step 2: Commit**

```bash
git add mobile/src/services/storage/database.ts
git commit -m "feat(mobile): add SQLite tables for offline messaging"
```

---

### Task 14: Teacher messaging screen

**Files:**
- Create: `mobile/app/(app)/enseignant/messagerie.tsx`

- [ ] **Step 1: Create screen**

Build a React Native screen following the existing pattern from other enseignant screens. The screen should:
- Have two views: conversation list and chat view (use `useState` to toggle)
- FlatList for conversations with pull-to-refresh
- FlatList inverted for messages (chat style)
- TextInput + Send button at bottom
- Use `Api.get/post` for data fetching
- Cache to SQLite for offline-first reads
- Use theme colors from `src/utils/theme.ts`

This is a substantial file (~250 lines). Follow the patterns from existing screens in `mobile/app/(app)/enseignant/` for navigation, layout, and API usage.

Key structure:
```typescript
import { useState, useEffect, useCallback } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, Text, RefreshControl } from 'react-native';
import { enseignantApi } from '../../../src/services/api/client';
import { getDB } from '../../../src/services/storage/database';
import { Colors, Typography, Spacing } from '../../../src/utils/theme';
import { Api } from '../../../src/services/api/client';

export default function MessagerieEnseignant() {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Load conversations on mount
  // Switch between list and chat view based on activeConv
  // Send messages, mark as read, etc.
}
```

- [ ] **Step 2: Add navigation link from enseignant dashboard**

In `mobile/app/(app)/enseignant/dashboard.tsx` (or equivalent), add a "Messages" button/card that navigates to the messagerie screen using `router.push('/enseignant/messagerie')`.

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(app)/enseignant/messagerie.tsx
git commit -m "feat(mobile): teacher messaging screen with offline support"
```

---

### Task 15: Parent messaging screen

**Files:**
- Create: `mobile/app/(app)/parent/messagerie.tsx`

- [ ] **Step 1: Create screen**

Same pattern as teacher screen but adapted for parent context:
- Parent selects from their children's teachers
- Uses `parentApi` instead of `enseignantApi`
- Navigation from parent dashboard

- [ ] **Step 2: Add navigation link from parent dashboard**

- [ ] **Step 3: Commit**

```bash
git add mobile/app/(app)/parent/messagerie.tsx
git commit -m "feat(mobile): parent messaging screen with offline support"
```

---

## Chunk 5: Final Integration & Verification

### Task 16: End-to-end verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && npm test`
Expected: All tests pass (60 existing + ~10 new)

- [ ] **Step 2: Run lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

- [ ] **Step 3: Verify dashboard manually**

Run: `npx serve dashboard -l 3001`
Check:
- Sidebar shows "Messagerie" for all roles
- Badge updates with unread count
- New conversation modal works
- Chat view displays messages correctly
- Sending a message works

- [ ] **Step 4: Verify mobile TypeScript**

Run: `cd mobile && npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 5: Final commit if any adjustments**

```bash
git add -A
git commit -m "fix: adjustments from end-to-end verification"
```
