// src/services/storage/database.ts
// Base de données SQLite locale (Expo SQLite)
// Stratégie offline-first : toutes les données critiques sont stockées localement

import * as SQLite from 'expo-sqlite';
import { insererOperationPendante, getOperationsPendantesDb, marquerOperationSyncedDb } from './queries';

let db: SQLite.SQLiteDatabase;

export async function ouvrirBD(): Promise<void> {
  db = await SQLite.openDatabaseAsync('ecolemanager.db', {
    enableChangeListener: true,
  });

  await db.execAsync('PRAGMA journal_mode = WAL;');
  await db.execAsync('PRAGMA foreign_keys = ON;');

  await creerTables();
}

export function getDB(): SQLite.SQLiteDatabase {
  if (!db) throw new Error('BD non initialisée — appeler ouvrirBD() d\'abord');
  return db;
}

// ── Schéma local — source unique de vérité ───────────────────────
// Utilisé à la fois par creerTables() (app, via expo-sqlite) et par les
// helpers de test (mobile/__tests__/helpers/seedDb.ts, via better-sqlite3).
// Ne JAMAIS dupliquer ce DDL ailleurs.
export const SCHEMA_SQL = `
    -- Session utilisateur
    CREATE TABLE IF NOT EXISTS session (
      id               TEXT PRIMARY KEY,
      utilisateur_id   TEXT NOT NULL,
      etablissement_id TEXT NOT NULL,
      nom_complet      TEXT NOT NULL,
      role             TEXT NOT NULL,
      token            TEXT NOT NULL,
      etablissement_nom TEXT,
      derniere_sync    TEXT,
      created_at       TEXT DEFAULT (datetime('now'))
    );

    -- Élèves / inscriptions
    CREATE TABLE IF NOT EXISTS eleves (
      id               TEXT PRIMARY KEY,
      nom              TEXT NOT NULL,
      prenom           TEXT NOT NULL,
      inscription_id   TEXT NOT NULL,
      classe           TEXT,
      photo_url        TEXT,
      matricule        TEXT,
      updated_at       TEXT
    );

    -- Évaluations
    CREATE TABLE IF NOT EXISTS evaluations (
      id               TEXT PRIMARY KEY,
      affectation_id   TEXT,
      type             TEXT NOT NULL,
      numero           INTEGER,
      titre            TEXT,
      date_evaluation  TEXT,
      note_max         REAL DEFAULT 20,
      notes_publiees   INTEGER DEFAULT 0,
      matiere          TEXT,
      classe           TEXT,
      updated_at       TEXT
    );

    -- Notes (saisies localement, à synchroniser)
    CREATE TABLE IF NOT EXISTS notes (
      id               TEXT PRIMARY KEY,
      evaluation_id    TEXT NOT NULL,
      eleve_id         TEXT NOT NULL,
      inscription_id   TEXT NOT NULL,
      valeur           REAL,
      est_absent       INTEGER DEFAULT 0,
      absence_justifiee INTEGER DEFAULT 0,
      appreciation     TEXT,
      saisie_at        TEXT DEFAULT (datetime('now')),
      synced           INTEGER DEFAULT 0,   -- 0 = en attente de sync
      FOREIGN KEY (evaluation_id) REFERENCES evaluations(id)
    );

    -- Appels et présences
    CREATE TABLE IF NOT EXISTS appels (
      id               TEXT PRIMARY KEY,
      cours_id         TEXT,
      date_cours       TEXT NOT NULL,
      matiere          TEXT,
      classe           TEXT,
      heure_debut      TEXT,
      heure_fin        TEXT,
      statut           TEXT DEFAULT 'ouvert',
      synced           INTEGER DEFAULT 1,
      updated_at       TEXT
    );

    CREATE TABLE IF NOT EXISTS presences (
      id               TEXT PRIMARY KEY,
      appel_id         TEXT NOT NULL,
      inscription_id   TEXT NOT NULL,
      eleve_id         TEXT NOT NULL,
      eleve_nom        TEXT NOT NULL,
      eleve_prenom     TEXT NOT NULL,
      statut           TEXT DEFAULT 'non_saisi',
      minutes_retard   INTEGER DEFAULT 0,
      est_justifie     INTEGER DEFAULT 0,
      synced           INTEGER DEFAULT 0,
      updated_at       TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (appel_id) REFERENCES appels(id)
    );

    -- Emploi du temps
    CREATE TABLE IF NOT EXISTS edt (
      id               TEXT PRIMARY KEY,
      jour_semaine     INTEGER NOT NULL,   -- 1=Lundi … 5=Vendredi
      heure_debut      TEXT NOT NULL,
      heure_fin        TEXT NOT NULL,
      matiere          TEXT NOT NULL,
      classe_id        TEXT,
      classe           TEXT,
      salle            TEXT,
      couleur          TEXT
    );

    -- Absences des enfants (parent)
    CREATE TABLE IF NOT EXISTS absences (
      id               TEXT PRIMARY KEY,
      eleve_id         TEXT NOT NULL,
      date_cours       TEXT NOT NULL,
      matiere          TEXT,
      statut           TEXT NOT NULL,
      est_justifie     INTEGER DEFAULT 0,
      justification    TEXT,
      updated_at       TEXT
    );

    -- Notes reçues (parent — lecture seule)
    CREATE TABLE IF NOT EXISTS notes_parent (
      id               TEXT PRIMARY KEY,
      eleve_id         TEXT NOT NULL,
      matiere          TEXT NOT NULL,
      type_eval        TEXT,
      date_evaluation  TEXT,
      valeur           REAL,
      trimestre        INTEGER,
      updated_at       TEXT
    );

    -- Moyennes (parent)
    CREATE TABLE IF NOT EXISTS moyennes (
      id               TEXT PRIMARY KEY,
      eleve_id         TEXT NOT NULL,
      matiere          TEXT NOT NULL,
      trimestre        INTEGER NOT NULL,
      moyenne          REAL,
      rang_classe      INTEGER,
      updated_at       TEXT
    );

    -- Bulletins disponibles (parent)
    CREATE TABLE IF NOT EXISTS bulletins (
      id               TEXT PRIMARY KEY,
      eleve_id         TEXT NOT NULL,
      trimestre        INTEGER NOT NULL,
      moyenne_generale REAL,
      rang             INTEGER,
      rang_sur         INTEGER,
      mention          TEXT,
      bulletin_url     TEXT,
      telechargé       INTEGER DEFAULT 0,
      updated_at       TEXT
    );

    -- File d'opérations hors-ligne à envoyer
    CREATE TABLE IF NOT EXISTS operations_pending (
      id               TEXT PRIMARY KEY,
      type             TEXT NOT NULL,
      payload          TEXT NOT NULL,     -- JSON
      created_at_local TEXT DEFAULT (datetime('now')),
      tentatives       INTEGER DEFAULT 0,
      statut           TEXT DEFAULT 'en_attente',  -- en_attente | erreur | envoyé
      erreur_msg       TEXT
    );

    -- Index pour les requêtes les plus fréquentes
    CREATE INDEX IF NOT EXISTS idx_presences_appel    ON presences(appel_id);
    CREATE INDEX IF NOT EXISTS idx_notes_evaluation   ON notes(evaluation_id);
    CREATE INDEX IF NOT EXISTS idx_absences_eleve     ON absences(eleve_id);
    CREATE INDEX IF NOT EXISTS idx_notes_parent_eleve ON notes_parent(eleve_id);
    CREATE INDEX IF NOT EXISTS idx_ops_statut         ON operations_pending(statut);
  `;

async function creerTables() {
  await db.execAsync(SCHEMA_SQL);
}

// ── Helpers génériques ───────────────────────────────────────────

export async function upsertEleves(eleves: any[]): Promise<void> {
  const db = getDB();
  for (const e of eleves) {
    await db.runAsync(
      `INSERT INTO eleves (id, nom, prenom, inscription_id, classe, photo_url, matricule, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         nom=excluded.nom, prenom=excluded.prenom, classe=excluded.classe, updated_at=excluded.updated_at`,
      [e.id, e.nom, e.prenom, e.inscription_id, e.classe, e.photo_url, e.matricule, e.updated_at]
    );
  }
}

export async function upsertEvaluations(evals: any[]): Promise<void> {
  const db = getDB();
  for (const ev of evals) {
    await db.runAsync(
      `INSERT INTO evaluations (id, affectation_id, type, numero, titre, date_evaluation, note_max, notes_publiees, matiere, classe, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type=excluded.type, notes_publiees=excluded.notes_publiees, updated_at=excluded.updated_at`,
      [ev.id, ev.affectation_id, ev.type, ev.numero, ev.titre, ev.date_evaluation,
       ev.note_max, ev.notes_publiees ? 1 : 0, ev.matiere, ev.classe, ev.updated_at]
    );
  }
}

export async function sauvegarderNoteLocale(note: {
  id: string; evaluation_id: string; eleve_id: string; inscription_id: string;
  valeur: number | null; est_absent: boolean; absence_justifiee: boolean; appreciation?: string;
}): Promise<void> {
  const db = getDB();
  await db.runAsync(
    `INSERT INTO notes (id, evaluation_id, eleve_id, inscription_id, valeur, est_absent, absence_justifiee, appreciation, synced)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       valeur=excluded.valeur, est_absent=excluded.est_absent,
       absence_justifiee=excluded.absence_justifiee, appreciation=excluded.appreciation,
       synced=0, saisie_at=datetime('now')`,
    [note.id, note.evaluation_id, note.eleve_id, note.inscription_id,
     note.valeur, note.est_absent ? 1 : 0, note.absence_justifiee ? 1 : 0, note.appreciation ?? null]
  );
}

// Peuple les présences locales à l'ouverture d'un appel (GET /appels/cours
// renvoie l'effectif réel de la classe — la table locale est vide avant ça,
// aucune sync ne pousse les présences).
export async function populerPresencesLocales(appelId: string, eleves: {
  inscription_id: string; eleve_id: string; nom: string; prenom: string;
  statut: string; minutes_retard: number;
}[]): Promise<void> {
  const db = getDB();
  for (const e of eleves) {
    await db.runAsync(
      `INSERT OR IGNORE INTO presences (id, appel_id, inscription_id, eleve_id, eleve_nom, eleve_prenom, statut, minutes_retard, synced)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [`${appelId}_${e.inscription_id}`, appelId, e.inscription_id, e.eleve_id, e.nom, e.prenom, e.statut, e.minutes_retard]
    );
  }
}

export async function sauvegarderPresenceLocale(p: {
  id: string; appel_id: string; inscription_id: string; eleve_id: string;
  eleve_nom: string; eleve_prenom: string;
  statut: string; minutes_retard?: number;
}): Promise<void> {
  const db = getDB();
  await db.runAsync(
    `UPDATE presences SET statut=?, minutes_retard=?, synced=0, updated_at=datetime('now')
     WHERE appel_id=? AND inscription_id=?`,
    [p.statut, p.minutes_retard ?? 0, p.appel_id, p.inscription_id]
  );
}

export async function ajouterOperationPendante(type: string, payload: object): Promise<void> {
  const db = getDB();
  const { v4: uuid } = await import('react-native-uuid' as any).catch(() => ({ v4: () => Date.now().toString() }));
  await insererOperationPendante(db, uuid() as string, type, JSON.stringify(payload));
}

export async function getOperationsPendantes(): Promise<any[]> {
  return getOperationsPendantesDb(getDB());
}

export async function marquerOperationSynced(id: string): Promise<void> {
  await marquerOperationSyncedDb(getDB(), id);
}
