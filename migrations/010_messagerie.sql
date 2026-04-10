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
