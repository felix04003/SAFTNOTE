// __tests__/helpers/seedDb.ts
// Helpers de seed pour les tests niveau A (SQL réel).
// Le schéma vient de SCHEMA_SQL exporté par src/services/storage/database.ts —
// SOURCE UNIQUE, jamais recopié à la main ici.

import { SCHEMA_SQL } from '../../src/services/storage/database';
import { creerAdaptateurSqliteReel, RealSqliteDb } from './sqliteRealMock';

let compteurId = 0;
function idUnique(prefixe: string): string {
  compteurId += 1;
  return `${prefixe}_${compteurId}`;
}

/** Ouvre un SQLite :memory: et applique le schéma réel de l'app. */
export async function creerBaseTest(): Promise<RealSqliteDb> {
  const db = creerAdaptateurSqliteReel(':memory:');
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await db.execAsync(SCHEMA_SQL);
  return db;
}

export interface EleveSeed {
  id?: string;
  nom: string;
  prenom: string;
  inscription_id?: string;
  matricule?: string;
}

/** Insère une classe : N élèves rattachés à `classe` (et `classe_id` côté edt). */
export async function seedClasse(
  db: RealSqliteDb,
  opts: { classe: string; eleves: EleveSeed[] }
): Promise<{ classe: string; eleves: Required<EleveSeed>[] }> {
  const eleves: Required<EleveSeed>[] = [];
  for (const e of opts.eleves) {
    const id = e.id ?? idUnique('eleve');
    const inscriptionId = e.inscription_id ?? idUnique('inscr');
    const matricule = e.matricule ?? id;
    await db.runAsync(
      `INSERT INTO eleves (id, nom, prenom, inscription_id, classe, matricule) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, e.nom, e.prenom, inscriptionId, opts.classe, matricule]
    );
    eleves.push({ id, nom: e.nom, prenom: e.prenom, inscription_id: inscriptionId, matricule });
  }
  return { classe: opts.classe, eleves };
}

export interface EdtSeed {
  id?: string;
  jour_semaine: number;
  heure_debut: string;
  heure_fin: string;
  matiere: string;
  classe_id: string;
  classe: string;
  salle?: string;
}

/** Insère des créneaux d'emploi du temps. */
export async function seedEdt(db: RealSqliteDb, creneaux: EdtSeed[]): Promise<void> {
  for (const c of creneaux) {
    await db.runAsync(
      `INSERT INTO edt (id, jour_semaine, heure_debut, heure_fin, matiere, classe_id, classe, salle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [c.id ?? idUnique('edt'), c.jour_semaine, c.heure_debut, c.heure_fin, c.matiere, c.classe_id, c.classe, c.salle ?? null]
    );
  }
}

export interface AppelSeed {
  id?: string;
  date_cours: string;
  matiere?: string;
  classe?: string;
}

/** Insère un appel (parent des presences — FK appel_id). */
export async function seedAppel(db: RealSqliteDb, appel: AppelSeed): Promise<string> {
  const id = appel.id ?? idUnique('appel');
  await db.runAsync(
    `INSERT INTO appels (id, date_cours, matiere, classe) VALUES (?, ?, ?, ?)`,
    [id, appel.date_cours, appel.matiere ?? null, appel.classe ?? null]
  );
  return id;
}

export interface PresenceSeed {
  id?: string;
  appel_id: string;
  inscription_id: string;
  eleve_id: string;
  eleve_nom: string;
  eleve_prenom: string;
  statut: string; // 'absent' | 'present' | ...
}

/** Insère des présences rattachées à un appel déjà seedé. */
export async function seedPresences(db: RealSqliteDb, presences: PresenceSeed[]): Promise<void> {
  for (const p of presences) {
    await db.runAsync(
      `INSERT INTO presences (id, appel_id, inscription_id, eleve_id, eleve_nom, eleve_prenom, statut)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p.id ?? idUnique('presence'), p.appel_id, p.inscription_id, p.eleve_id, p.eleve_nom, p.eleve_prenom, p.statut]
    );
  }
}

export interface EvaluationSeed {
  id?: string;
  classe: string;
  matiere: string;
  notes_publiees?: boolean;
  type?: string;
}

/** Insère une évaluation (parent des notes — FK evaluation_id). */
export async function seedEvaluation(db: RealSqliteDb, ev: EvaluationSeed): Promise<string> {
  const id = ev.id ?? idUnique('eval');
  await db.runAsync(
    `INSERT INTO evaluations (id, type, classe, matiere, notes_publiees) VALUES (?, ?, ?, ?, ?)`,
    [id, ev.type ?? 'devoir', ev.classe, ev.matiere, ev.notes_publiees === false ? 0 : 1]
  );
  return id;
}

export interface NoteSeed {
  id?: string;
  evaluation_id: string;
  eleve_id: string;
  inscription_id: string;
  valeur: number | null;
  est_absent?: boolean;
}

/** Insère des notes rattachées à une évaluation déjà seedée. */
export async function seedNotes(db: RealSqliteDb, notes: NoteSeed[]): Promise<void> {
  for (const n of notes) {
    await db.runAsync(
      `INSERT INTO notes (id, evaluation_id, eleve_id, inscription_id, valeur, est_absent)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [n.id ?? idUnique('note'), n.evaluation_id, n.eleve_id, n.inscription_id, n.valeur, n.est_absent ? 1 : 0]
    );
  }
}
