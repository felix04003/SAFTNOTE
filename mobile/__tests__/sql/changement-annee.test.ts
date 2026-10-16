/**
 * Tests SQL réels — changement d'année scolaire (fin d'année) : le téléphone repart de zéro, sans jamais perdre
 * une saisie qui n'est pas encore partie. Vrai SQLite en mémoire, schéma réel (SCHEMA_SQL).
 */

import { traiterAnnee } from '../../src/services/sync/changementAnnee';
import { creerBaseTest, seedClasse, seedEvaluation, seedNotes, seedAppel, seedPresences, seedEdt } from '../helpers/seedDb';
import { RealSqliteDb } from '../helpers/sqliteRealMock';

let db: RealSqliteDb;

async function compter(table: string): Promise<number> {
  const r: any = await db.getFirstAsync(`SELECT COUNT(*) AS n FROM ${table}`);
  return r.n;
}
async function anneeLocale(): Promise<string | null> {
  const r: any = await db.getFirstAsync("SELECT valeur FROM meta WHERE cle = 'annee_scolaire_id'");
  return r ? r.valeur : null;
}
async function operation(statut: string) {
  await db.runAsync("INSERT INTO operations_pending (id, type, payload, statut) VALUES (?, 'notes.saisir', '{}', ?)", [`op_${statut}_${Math.random()}`, statut]);
}

beforeEach(async () => {
  db = await creerBaseTest();
  await db.runAsync("INSERT INTO session (id, utilisateur_id, etablissement_id, nom_complet, role, token, derniere_sync) VALUES ('s', 'u', 'e', 'Awa', 'enseignant', '', '2026-06-01T10:00:00Z')");
  await seedClasse(db, { classe: '6ème A', eleves: [{ nom: 'Diop', prenom: 'Awa' }, { nom: 'Ba', prenom: 'Moussa' }] });
  await db.runAsync("INSERT INTO periodes (id, numero, libelle, date_debut, date_fin) VALUES ('p1', 1, 'Trimestre 1', '2025-10-01', '2025-12-20')");

  // Données « filles » : sans elles, l'ordre de suppression (notes avant évaluations, présences avant appels) n'est
  // pas éprouvé et la clé étrangère n'échoue qu'avec un vrai serveur
  const eleves: any[] = await db.getAllAsync('SELECT id, nom, prenom, inscription_id FROM eleves');
  const evaluationId = await seedEvaluation(db, { classe: '6ème A', matiere: 'Maths' });
  await seedNotes(db, eleves.map((e) => ({ evaluation_id: evaluationId, eleve_id: e.id, inscription_id: e.inscription_id, valeur: 12 })));
  await seedEdt(db, [{ jour_semaine: 1, heure_debut: '08:00', heure_fin: '09:00', matiere: 'Maths', classe_id: 'c1', classe: '6ème A' }]);   // l'EDT n'est remplacé que s'il n'est pas vide : la purge doit le vider
  const appelId = await seedAppel(db, { date_cours: '2025-11-03', matiere: 'Maths', classe: '6ème A' });
  await seedPresences(db, eleves.map((e) => ({ appel_id: appelId, inscription_id: e.inscription_id, eleve_id: e.id, eleve_nom: e.nom, eleve_prenom: e.prenom, statut: 'present' })));
});

describe('traiterAnnee', () => {
  it('serveur sans information d\'année (ancienne version) : rien ne change', async () => {
    expect(await traiterAnnee(db, null)).toBe('inchange');
    expect(await traiterAnnee(db, undefined)).toBe('inchange');
    expect(await compter('eleves')).toBe(2);
    expect(await anneeLocale()).toBeNull();
  });

  it('première synchronisation : l\'année est mémorisée, rien n\'est vidé', async () => {
    expect(await traiterAnnee(db, 'annee-1')).toBe('inchange');
    expect(await anneeLocale()).toBe('annee-1');
    expect(await compter('eleves')).toBe(2);
  });

  it('même année : rien ne change', async () => {
    await traiterAnnee(db, 'annee-1');
    expect(await traiterAnnee(db, 'annee-1')).toBe('inchange');
    expect(await compter('eleves')).toBe(2);
  });

  it('nouvelle année et rien en attente : données de l\'ancienne année vidées, synchro complète demandée', async () => {
    await traiterAnnee(db, 'annee-1');
    await operation('envoyé');                                                  // une opération déjà partie ne retient rien
    expect(await traiterAnnee(db, 'annee-2')).toBe('purge');
    for (const table of ['eleves', 'evaluations', 'notes', 'appels', 'presences', 'edt']) expect(await compter(table)).toBe(0);
    expect(await anneeLocale()).toBe('annee-2');
    const session: any = await db.getFirstAsync('SELECT derniere_sync FROM session');
    expect(session.derniere_sync).toBeNull();                                   // tout sera retéléchargé
    expect(await compter('session')).toBe(1);                                   // la session, elle, reste
    expect(await compter('periodes')).toBe(1);                                  // remplacée en bloc par la synchro, pas ici
  });

  it.each(['en_attente', 'erreur'])('nouvelle année mais une saisie « %s » : RIEN n\'est supprimé, l\'année n\'est pas mémorisée', async (statut) => {
    await traiterAnnee(db, 'annee-1');
    await operation(statut);
    expect(await traiterAnnee(db, 'annee-2')).toBe('differe');
    expect(await compter('eleves')).toBe(2);
    expect(await compter('notes')).toBe(2);                                     // les saisies locales ne sont pas touchées
    expect(await anneeLocale()).toBe('annee-1');                                // on réessaiera à la prochaine synchro
    expect(await compter('operations_pending')).toBe(1);
  });

  it('une fois la saisie envoyée, la synchronisation suivante termine le changement', async () => {
    await traiterAnnee(db, 'annee-1');
    await operation('en_attente');
    expect(await traiterAnnee(db, 'annee-2')).toBe('differe');
    await db.runAsync("UPDATE operations_pending SET statut = 'envoyé'");
    expect(await traiterAnnee(db, 'annee-2')).toBe('purge');
    expect(await compter('eleves')).toBe(0);
  });
});
