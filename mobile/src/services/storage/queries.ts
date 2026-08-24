// src/services/storage/queries.ts
// Requêtes SQL des écrans enseignant, extraites en fonctions pures (db + params → data)
// pour être testables contre un vrai SQLite (voir mobile/__tests__/sql/enseignant-queries.test.ts)
// sans avoir à monter les écrans React.
//
// Convention : chaque requête est déclarée UNE fois comme constante SQL_*,
// utilisée à la fois par sa fonction d'accès et par le registre
// REQUETES_PREPARABLES (test de garde générique anti-régression).

export interface DbLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: any[]): Promise<any>;
  getFirstAsync<T = any>(sql: string, params: any[]): Promise<T | null>;
  getAllAsync<T = any>(sql: string, params: any[]): Promise<T[]>;
}

// ── classes.tsx ───────────────────────────────────────────────────

const SQL_CLASSES_DEPUIS_EDT = `
  SELECT
    classe_id,
    classe,
    COUNT(DISTINCT matiere) AS nb_matieres
  FROM edt
  WHERE classe IS NOT NULL AND classe_id IS NOT NULL
  GROUP BY classe_id, classe
  ORDER BY classe
`;
export function getClassesDepuisEdt(db: DbLike) {
  return db.getAllAsync<{ classe_id: string; classe: string; nb_matieres: number }>(SQL_CLASSES_DEPUIS_EDT, []);
}

const SQL_NB_ELEVES_CLASSE = `SELECT COUNT(*) as count FROM eleves WHERE classe=?`;
export function getNbElevesClasse(db: DbLike, classe: string) {
  return db.getFirstAsync<{ count: number }>(SQL_NB_ELEVES_CLASSE, [classe]);
}

const SQL_NB_ABSENCES_JOUR_CLASSE = `
  SELECT COUNT(*) as count FROM absences a
  JOIN eleves e ON e.id = a.eleve_id
  WHERE e.classe=? AND a.date_cours=date('now') AND a.est_justifie=0
`;
export function getNbAbsencesJourClasse(db: DbLike, classe: string) {
  return db.getFirstAsync<{ count: number }>(SQL_NB_ABSENCES_JOUR_CLASSE, [classe]);
}

const SQL_MOYENNE_CLASSE = `
  SELECT AVG(m.moyenne) as moy FROM moyennes m
  JOIN eleves e ON e.id = m.eleve_id
  WHERE e.classe=?
`;
export function getMoyenneClasse(db: DbLike, classe: string) {
  return db.getFirstAsync<{ moy: number | null }>(SQL_MOYENNE_CLASSE, [classe]);
}

// ── index.tsx ─────────────────────────────────────────────────────

const SQL_NB_NOTES_EN_ATTENTE = `SELECT COUNT(*) as count FROM notes WHERE synced=0`;
export function getNbNotesEnAttente(db: DbLike) {
  return db.getAllAsync<{ count: number }>(SQL_NB_NOTES_EN_ATTENTE, []);
}

// Sparkline absences — jointure presences → appels : la date de cours vit
// sur appels.date_cours (presences n'a PAS de colonne date_cours).
const SQL_SPARKLINE_ABSENCES = `
  SELECT a.date_cours as date_cours, COUNT(*) as nb
  FROM presences p
  JOIN appels a ON a.id = p.appel_id
  WHERE p.statut='absent' AND a.date_cours >= date('now','-6 days')
  GROUP BY a.date_cours ORDER BY a.date_cours
`;
export function getSparklineAbsences(db: DbLike) {
  return db.getAllAsync<{ date_cours: string; nb: number }>(SQL_SPARKLINE_ABSENCES, []);
}

// ── moyennes.tsx ──────────────────────────────────────────────────

const SQL_CLASSES_DISTINCTES = `SELECT DISTINCT classe_id, classe FROM edt WHERE classe IS NOT NULL ORDER BY classe`;
export function getClassesDistinctes(db: DbLike) {
  return db.getAllAsync<{ classe_id: string; classe: string }>(SQL_CLASSES_DISTINCTES, []);
}

const SQL_MATIERES_CLASSE = `SELECT DISTINCT matiere FROM evaluations WHERE classe=? ORDER BY matiere`;
export function getMatieresClasse(db: DbLike, classe: string) {
  return db.getAllAsync<{ matiere: string }>(SQL_MATIERES_CLASSE, [classe]);
}

const SQL_MOYENNES_CLASSE_MATIERE = `
  SELECT e.id AS eleve_id, e.nom, e.prenom,
         COUNT(n.id) AS nb_notes,
         AVG(CASE WHEN n.est_absent=0 AND n.valeur IS NOT NULL THEN n.valeur END) AS moyenne
  FROM eleves e
  JOIN evaluations ev ON ev.classe=?
  LEFT JOIN notes n ON n.eleve_id=e.id AND n.evaluation_id=ev.id
  WHERE e.classe=? AND ev.matiere=? AND ev.notes_publiees=1
  GROUP BY e.id
  ORDER BY moyenne DESC NULLS LAST, e.nom
`;
export function getMoyennesClasseMatiere(db: DbLike, classe: string, matiere: string) {
  return db.getAllAsync<{
    eleve_id: string; nom: string; prenom: string; nb_notes: number; moyenne: number | null;
  }>(SQL_MOYENNES_CLASSE_MATIERE, [classe, classe, matiere]);
}

// ── notes-saisie.tsx ──────────────────────────────────────────────

const SQL_ELEVES_EVALUATION = `
  SELECT e.id, e.nom, e.prenom, e.inscription_id,
         n.valeur, n.est_absent, n.absence_justifiee
  FROM eleves e
  LEFT JOIN notes n ON n.eleve_id=e.id AND n.evaluation_id=?
  WHERE e.classe=?
  ORDER BY e.nom, e.prenom
`;
export function getElevesEvaluation(db: DbLike, evaluationId: string, classe: string) {
  return db.getAllAsync<{
    id: string; nom: string; prenom: string; inscription_id: string;
    valeur: number | null; est_absent: number | null; absence_justifiee: number | null;
  }>(SQL_ELEVES_EVALUATION, [evaluationId, classe]);
}

// ── operations_pending — file de sync montante ───────────────────

const SQL_INSERER_OPERATION_PENDANTE = `INSERT INTO operations_pending (id, type, payload) VALUES (?, ?, ?)`;
export function insererOperationPendante(db: DbLike, id: string, type: string, payload: string) {
  return db.runAsync(SQL_INSERER_OPERATION_PENDANTE, [id, type, payload]);
}

const SQL_GET_OPERATIONS_PENDANTES = `
  SELECT * FROM operations_pending
    WHERE (statut = 'en_attente') OR (statut = 'erreur' AND tentatives < 5)
    ORDER BY created_at_local
    LIMIT 50
`;
export function getOperationsPendantesDb(db: DbLike) {
  return db.getAllAsync<any>(SQL_GET_OPERATIONS_PENDANTES, []);
}

const SQL_MARQUER_OPERATION_SYNCED = `UPDATE operations_pending SET statut='envoyé' WHERE id=?`;
export function marquerOperationSyncedDb(db: DbLike, id: string) {
  return db.runAsync(SQL_MARQUER_OPERATION_SYNCED, [id]);
}

// ── Registre des requêtes préparables ────────────────────────────
// Utilisé par le test de garde générique (§4.5 du plan) : chaque requête ici
// doit pouvoir être `prepare()`-ée contre le vrai schéma sans throw.
// Les SQL référencées sont les MÊMES constantes que celles utilisées par les
// fonctions ci-dessus (pas de copie).
export const REQUETES_PREPARABLES: { nom: string; sql: string }[] = [
  { nom: 'getClassesDepuisEdt', sql: SQL_CLASSES_DEPUIS_EDT },
  { nom: 'getNbElevesClasse', sql: SQL_NB_ELEVES_CLASSE },
  { nom: 'getNbAbsencesJourClasse', sql: SQL_NB_ABSENCES_JOUR_CLASSE },
  { nom: 'getMoyenneClasse', sql: SQL_MOYENNE_CLASSE },
  { nom: 'getNbNotesEnAttente', sql: SQL_NB_NOTES_EN_ATTENTE },
  { nom: 'getSparklineAbsences', sql: SQL_SPARKLINE_ABSENCES },
  { nom: 'getClassesDistinctes', sql: SQL_CLASSES_DISTINCTES },
  { nom: 'getMatieresClasse', sql: SQL_MATIERES_CLASSE },
  { nom: 'getMoyennesClasseMatiere', sql: SQL_MOYENNES_CLASSE_MATIERE },
  { nom: 'getElevesEvaluation', sql: SQL_ELEVES_EVALUATION },
  { nom: 'insererOperationPendante', sql: SQL_INSERER_OPERATION_PENDANTE },
  { nom: 'getOperationsPendantesDb', sql: SQL_GET_OPERATIONS_PENDANTES },
  { nom: 'marquerOperationSyncedDb', sql: SQL_MARQUER_OPERATION_SYNCED },
];
