-- ════════════════════════════════════════════════════════════════
-- Migration 009 — Mise à jour des contraintes CHECK statut
--
-- Contexte : le workflow d'appel par les enseignants utilise les
-- valeurs 'ouvert' (appels) et 'non_saisi' (presences) qui étaient
-- absentes des contraintes CHECK initiales.
-- ════════════════════════════════════════════════════════════════

-- ── appels.statut ────────────────────────────────────────────────
ALTER TABLE appels DROP CONSTRAINT IF EXISTS appels_statut_check;
ALTER TABLE appels ADD CONSTRAINT appels_statut_check
    CHECK (statut IN ('ouvert', 'effectue', 'cours_annule', 'non_effectue'));

-- Mettre à jour la valeur par défaut pour refléter le workflow :
-- un appel est d'abord 'ouvert', puis 'effectue' après clôture.
ALTER TABLE appels ALTER COLUMN statut SET DEFAULT 'ouvert';

-- ── presences.statut ─────────────────────────────────────────────
ALTER TABLE presences DROP CONSTRAINT IF EXISTS presences_statut_check;
ALTER TABLE presences ADD CONSTRAINT presences_statut_check
    CHECK (statut IN (
        'non_saisi',    -- Pré-rempli à la création de l'appel
        'present',
        'absent',
        'retard',
        'sorti_avant',
        'dispense'
    ));

-- Mettre à jour la valeur par défaut
ALTER TABLE presences ALTER COLUMN statut SET DEFAULT 'non_saisi';
