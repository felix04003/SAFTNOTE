// src/services/evaluations/creerEvaluation.ts
// Création d'une évaluation depuis le mobile (écran app/(app)/enseignant/evaluations.tsx), en ligne ou hors ligne.
//
// L'identifiant est choisi ICI (UUID) et gardé tel quel côté serveur : l'évaluation locale, la création en ligne et
// la création rejouée plus tard (file hors ligne) désignent la même ligne. Avant, l'écran inventait un id
// « eval_<date> » et « créait » l'évaluation en envoyant des notes vides à une évaluation inexistante : rien n'était
// jamais créé sur le serveur.

import * as Crypto from 'expo-crypto';
import { ApiError, enseignantApi } from '../api/client';
import { getDB, ajouterOperationPendante } from '../storage/database';

export interface ChampsEvaluation {
  affectation_id:  string;
  type:            string;
  titre?:          string | null;
  date_evaluation: string;        // AAAA-MM-JJ
  note_max:        number;
}

export interface EvaluationCreee { id: string; enLigne: boolean }

/** Période qui contient la date ; à défaut, la dernière commencée, sinon la première */
export async function periodePourDate(date: string): Promise<{ id: string; numero: number; date_debut: string; date_fin: string } | null> {
  const periodes: any[] = await getDB().getAllAsync('SELECT * FROM periodes ORDER BY numero');
  if (periodes.length === 0) return null;
  const jour = date.slice(0, 10);
  const dedans = periodes.find((p) => p.date_debut.slice(0, 10) <= jour && jour <= p.date_fin.slice(0, 10));
  if (dedans) return dedans;
  const commencees = periodes.filter((p) => p.date_debut.slice(0, 10) <= jour);
  return commencees.length ? commencees[commencees.length - 1] : periodes[0];
}

export async function creerEvaluationMobile(champs: ChampsEvaluation): Promise<EvaluationCreee> {
  const db = getDB();
  const affectation: any = await db.getFirstAsync('SELECT * FROM affectations WHERE id = ?', [champs.affectation_id]);
  if (!affectation) throw new Error('Affectation inconnue : synchronisez l\'application puis réessayez.');

  const periode = await periodePourDate(champs.date_evaluation);
  if (!periode) throw new Error('Aucune période scolaire : synchronisez l\'application puis réessayez.');

  // Une évaluation est unique par (affectation, type, numéro, période) : on prend le premier numéro libre (1 à 5)
  const prises: any[] = await db.getAllAsync(
    `SELECT numero FROM evaluations
      WHERE affectation_id = ? AND type = ? AND substr(date_evaluation, 1, 10) BETWEEN ? AND ?`,
    [champs.affectation_id, champs.type, periode.date_debut.slice(0, 10), periode.date_fin.slice(0, 10)]);
  const utilises = new Set(prises.map((p) => Number(p.numero)));
  let numero = 1;
  while (utilises.has(numero)) numero++;
  if (numero > 5) throw new Error('Cinq évaluations de ce type existent déjà pour cette période.');

  const id = Crypto.randomUUID();
  const titre = champs.titre?.trim() || null;
  await db.runAsync(
    `INSERT INTO evaluations (id, affectation_id, type, numero, titre, date_evaluation, note_max, notes_publiees, matiere, classe, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
    [id, champs.affectation_id, champs.type, numero, titre, champs.date_evaluation, champs.note_max,
     affectation.matiere, affectation.classe, new Date().toISOString()]);

  const payload = {
    id, affectation_id: champs.affectation_id, periode_id: periode.id, type: champs.type, numero,
    ...(titre ? { titre } : {}), note_max: champs.note_max, date_evaluation: champs.date_evaluation.slice(0, 10),
  };

  try {
    await enseignantApi.creerEvaluation(payload);
    return { id, enLigne: true };
  } catch (err) {
    if (err instanceof ApiError && err.estHorsLigne) {
      await ajouterOperationPendante('evaluations.creer', payload);   // rejouée à la prochaine synchronisation
      return { id, enLigne: false };
    }
    // Refus du serveur (droits, doublon…) : inutile de garder une évaluation fantôme sur le téléphone
    await db.runAsync('DELETE FROM evaluations WHERE id = ?', [id]);
    throw err;
  }
}
