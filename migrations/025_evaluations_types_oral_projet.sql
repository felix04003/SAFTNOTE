-- ════════════════════════════════════════════════════════════════
-- Migration 025 — Types d'évaluation « oral » et « projet »
--
-- Contexte : le type énuméré type_evaluation (000), l'API (zod), le
-- dashboard et le mobile proposent sept types, mais la contrainte CHECK
-- de la table evaluations n'en autorisait que cinq : créer une évaluation
-- de type Oral ou Projet échouait en erreur de contrainte.
-- Idempotente (DROP IF EXISTS puis ADD), comme la migration 009.
-- ════════════════════════════════════════════════════════════════

ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_type_check;
ALTER TABLE evaluations ADD CONSTRAINT evaluations_type_check
    CHECK (type IN ('devoir', 'composition', 'interrogation', 'tp', 'expose', 'oral', 'projet'));
