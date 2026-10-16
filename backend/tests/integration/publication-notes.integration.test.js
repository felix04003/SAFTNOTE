'use strict';

// Base PostgreSQL réelle, de bout en bout : publier les notes → un job par élève
// noté → le worker envoie un SMS au parent principal de CET élève (tâche 2.6).

jest.mock('../../src/infrastructure/queue/bullmq', () => ({
  QUEUES: {}, initQueues: jest.fn(), getQueue: jest.fn(),
  enqueuerNotification: jest.fn().mockResolvedValue({}),
  enqueuerCalculMoyennes: jest.fn().mockResolvedValue({}),
  enqueuerGenerationBulletins: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerSMS: jest.fn(), envoyerOTP: jest.fn(),
}));
jest.mock('../../src/infrastructure/notifications/whatsapp.service', () => ({
  envoyerTemplate: jest.fn(),
}));

const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');
const { enqueuerNotification } = require('../../src/infrastructure/queue/bullmq');
const { envoyerSMS } = require('../../src/infrastructure/notifications/sms.service');

let db, request, seed, tokenEns, tokenAutreEcole, evaluationId, traiterNotification;
const parents = [];

async function creerParent(eleve, tel, nom) {
  const [p] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id, nom, prenom: 'Parent', telephone: tel, actif: true,
  }).returning('*');
  await db('parents_eleves').insert({ parent_id: p.id, eleve_id: eleve.id, lien: 'pere', est_contact_principal: true });
  await db('notifications_preferences').insert({
    utilisateur_id: p.id, canal_prefere: 'sms', heure_debut_notif: '00:00', heure_fin_notif: '23:59',
  });
  return p;
}

beforeAll(async () => {
  request = supertest(createIntegrationApp());
  ({ traiterNotification } = require('../../src/workers/notification.processor'));
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);

  // Parents des deux premiers élèves ; le troisième n'en a pas
  parents.push(await creerParent(seed.eleves[0].eleve, '+221770000051', 'Alpha'));
  parents.push(await creerParent(seed.eleves[1].eleve, '+221770000052', 'Beta'));

  const [matiere] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Physique', code: 'PHY' }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).returning('*');
  const [ev] = await db('evaluations').insert({
    affectation_id: aff.id, periode_id: seed.periodes[0].id, type: 'devoir', numero: 1, titre: 'Devoir 1',
    date_evaluation: '2024-11-15', note_max: 20,
  }).returning('*');
  evaluationId = ev.id;

  const valeurs = [14.5, 9, null]; // le 3e élève : absent justifié, sans valeur
  for (let i = 0; i < 3; i++) {
    await db('notes').insert({
      evaluation_id: ev.id, eleve_id: seed.eleves[i].eleve.id, inscription_id: seed.eleves[i].inscription.id,
      valeur: valeurs[i], est_absent: valeurs[i] === null, absence_justifiee: valeurs[i] === null,
      saisie_par: seed.enseignantUser.id,
    });
  }

  // Un 2e établissement avec son directeur
  const [etabB] = await db('etablissements').insert({
    nom: 'Collège B', code_officiel: 'TEST_PUB_B', type: 'college', pays: 'SN', ville: 'Thiès', actif: true,
  }).returning('*');
  const [dirB] = await db('utilisateurs').insert({
    etablissement_id: etabB.id, nom: 'Sy', prenom: 'Ali', email: 'dir.pub@test.sn', actif: true,
  }).returning('*');
  const role = await db('roles').where({ code: 'directeur' }).first();
  await db('utilisateur_roles').insert({ utilisateur_id: dirB.id, role_id: role.id, etablissement_id: etabB.id });
  tokenAutreEcole = await creerSession(dirB.id, etabB.id);
});

beforeEach(() => {
  enqueuerNotification.mockClear();
  envoyerSMS.mockReset().mockResolvedValue({ succes: true, messageIds: ['m'], segments: 1 });
});

afterAll(async () => { await closeTestDB(); });

const publier = (token) => request.put(`/api/v1/evaluations/${evaluationId}/publier`).set('Authorization', `Bearer ${token}`);

describe('publication des notes → notifications', () => {
  test('un autre établissement ne peut pas publier ces notes (404) et rien n\'est notifié', async () => {
    await publier(tokenAutreEcole).expect(404);

    expect(enqueuerNotification).not.toHaveBeenCalled();
    const ev = await db('evaluations').where({ id: evaluationId }).first('notes_publiees');
    expect(ev.notes_publiees).toBe(false);
  });

  test('publication : un job par élève ayant une note (pas pour l\'absent justifié), et les SMS partent au bon parent', async () => {
    const res = await publier(tokenEns).expect(200);

    expect(res.body.data.parents_notifies).toBe(2);
    expect(enqueuerNotification).toHaveBeenCalledTimes(2);
    const jobs = enqueuerNotification.mock.calls.map(([payload]) => payload);
    expect(jobs.map(j => j.inscription_id).sort()).toEqual(
      [seed.eleves[0].inscription.id, seed.eleves[1].inscription.id].sort());
    expect(jobs.every(j => j.type_notif === 'nouvelle_note' && j.evaluation_id === evaluationId)).toBe(true);

    // Le worker traite chaque job réel : un SMS par parent concerné, avec SA note
    for (const data of jobs) {
      const r = await traiterNotification({ id: 'j', data, moveToDelayed: jest.fn() });
      expect(r.statut).toBe('envoye');
    }
    const envois = Object.fromEntries(envoyerSMS.mock.calls.map(([tel, msg]) => [tel, msg]));
    expect(Object.keys(envois).sort()).toEqual(['+221770000051', '+221770000052']);
    expect(envois['+221770000051']).toContain('14.5');
    expect(envois['+221770000052']).toContain('9');

    const lignes = await db('journal_notifications').where({ etablissement_id: seed.etablissement.id, statut: 'envoye' });
    expect(lignes).toHaveLength(2);
  });

  test('republier : aucune nouvelle notification (pas de SMS en double)', async () => {
    const res = await publier(tokenEns).expect(200);

    expect(res.body.data).toMatchObject({ deja_publiees: true, parents_notifies: 0 });
    expect(enqueuerNotification).not.toHaveBeenCalled();
  });

  test('un élève sans parent est ignoré sans erreur (aucun SMS)', async () => {
    const r = await traiterNotification({
      id: 'j', moveToDelayed: jest.fn(),
      data: { type_notif: 'nouvelle_note', evaluation_id: evaluationId, inscription_id: seed.eleves[2].inscription.id },
    });
    expect(r).toMatchObject({ statut: 'skip', raison: 'parent_introuvable' });
    expect(envoyerSMS).not.toHaveBeenCalled();
  });
});
