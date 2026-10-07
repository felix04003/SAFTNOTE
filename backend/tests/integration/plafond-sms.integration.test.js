'use strict';

// Base PostgreSQL réelle : plafond mensuel de SMS par établissement
// (migration 023, tâche 2.6) — comptage, blocage, butoir, alertes, endpoints.

jest.mock('../../src/infrastructure/notifications/sms.service', () => ({ envoyerSMS: jest.fn(), envoyerOTP: jest.fn() }));
jest.mock('../../src/infrastructure/notifications/whatsapp.service', () => ({ envoyerTemplate: jest.fn() }));

const express = require('express');
const supertest = require('supertest');
const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp, creerSession,
} = require('./helpers');
const { envoyerSMS } = require('../../src/infrastructure/notifications/sms.service');
const { consommationMois, debutDeMois } = require('../../src/infrastructure/notifications/plafond-sms');

let db, requestNotif, seed, parent, evaluationId, appelId, traiterNotification, tokenDir, tokenEns;
const TEL_PARENT = '+221770000060';
const TEL_DIR    = '+221770000099';

const jobNote    = () => ({ id: 'j', moveToDelayed: jest.fn(), data: { type_notif: 'nouvelle_note', evaluation_id: evaluationId, inscription_id: seed.eleves[0].inscription.id } });
const jobAbsence = () => ({ id: 'j', moveToDelayed: jest.fn(), data: { type_notif: 'absence', inscription_id: seed.eleves[0].inscription.id, appel_id: appelId } });

async function fixerPlafond(plafond) {
  await db('politique_securite').where({ etablissement_id: seed.etablissement.id })
    .update({ sms_plafond_mensuel: plafond, sms_alerte_palier: 0, sms_alerte_mois: null });
}
async function viderJournal() { await db('journal_notifications').del(); }
async function consommer(segments, { canal = 'sms', statut = 'envoye', quand = new Date() } = {}) {
  await db('journal_notifications').insert({
    etablissement_id: seed.etablissement.id, destinataire_id: parent.id, canal, categorie: 'quotidien',
    type_notif: 'nouvelle_note', statut, segments, envoye_at: quand,
  });
}
const smsVers = (tel) => envoyerSMS.mock.calls.filter(([t]) => t === tel);

beforeAll(async () => {
  createIntegrationApp();                       // branche le pool sur la base de test
  // L'application d'intégration commune ne monte pas le routeur de notifications
  const errorHandler = require('../../src/middleware/error.middleware');
  const { notFound } = require('../../src/middleware/notFound.middleware');
  const appNotif = express();
  appNotif.use(express.json());
  appNotif.use('/api/v1', require('../../src/domains/notifications.routes'));
  appNotif.use(notFound);
  appNotif.use(errorHandler);
  requestNotif = supertest(appNotif);
  ({ traiterNotification } = require('../../src/workers/notification.processor'));
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  tokenDir = await creerSession(seed.directeur.id, seed.etablissement.id);
  tokenEns = await creerSession(seed.enseignantUser.id, seed.etablissement.id);
  await db('utilisateurs').where({ id: seed.directeur.id }).update({ telephone: TEL_DIR });

  [parent] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id, nom: 'Traoré', prenom: 'Kadiatou', telephone: TEL_PARENT, actif: true,
  }).returning('*');
  await db('parents_eleves').insert({ parent_id: parent.id, eleve_id: seed.eleves[0].eleve.id, lien: 'mere', est_contact_principal: true });
  await db('notifications_preferences').insert({ utilisateur_id: parent.id, canal_prefere: 'sms', heure_debut_notif: '00:00', heure_fin_notif: '23:59' });

  const [matiere] = await db('matieres').insert({ etablissement_id: seed.etablissement.id, nom: 'Chimie', code: 'CHI' }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id, classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).returning('*');
  const [ev] = await db('evaluations').insert({
    affectation_id: aff.id, periode_id: seed.periodes[0].id, type: 'devoir', numero: 1, note_max: 20,
    date_evaluation: '2024-11-15', notes_publiees: true,
  }).returning('*');
  evaluationId = ev.id;
  await db('notes').insert({
    evaluation_id: ev.id, eleve_id: seed.eleves[0].eleve.id, inscription_id: seed.eleves[0].inscription.id,
    valeur: 12, saisie_par: seed.enseignantUser.id,
  });
  const [plage] = await db('plages_horaires').insert({
    etablissement_id: seed.etablissement.id, numero: 1, libelle: '1ère heure', heure_debut: '08:00', heure_fin: '09:00',
  }).returning('*');
  const [edt] = await db('emplois_du_temps').insert({
    classe_id: seed.classe.id, affectation_id: aff.id, plage_id: plage.id, jour_semaine: 1,
  }).returning('*');
  const [appel] = await db('appels').insert({
    emploi_du_temps_id: edt.id, date_cours: '2024-11-18', effectue_par: seed.enseignantUser.id,
  }).returning('*');
  appelId = appel.id;
});

beforeEach(async () => {
  envoyerSMS.mockReset().mockResolvedValue({ succes: true, messageIds: ['m'], segments: 1 });
  await viderJournal();
  await fixerPlafond(100);
});

afterAll(async () => { await closeTestDB(); });

describe('consommation mensuelle', () => {
  test('somme les segments des SMS envoyés ce mois, et eux seuls', async () => {
    const moisPrecedent = new Date(debutDeMois().getTime() - 24 * 3600 * 1000);
    await consommer(3);                                            // compté
    await consommer(2, { statut: 'livre' });                       // compté
    await consommer(5, { canal: 'whatsapp' });                     // WhatsApp : pas un SMS
    await consommer(4, { statut: 'echec' });                       // non envoyé
    await consommer(1, { statut: 'annule' });                      // bloqué : jamais parti
    await consommer(7, { quand: moisPrecedent });                  // mois précédent

    const conso = await consommationMois(db, seed.etablissement.id);

    expect(conso).toMatchObject({ utilises: 5, plafond: 100, pourcentage: 5 });
  });
});

describe('plafond atteint', () => {
  test('au plafond : la note (non urgente) n\'est pas envoyée, et le blocage est tracé', async () => {
    await consommer(100);

    const r = await traiterNotification(jobNote());

    expect(r).toMatchObject({ statut: 'skip', raison: 'plafond_atteint' });
    expect(smsVers(TEL_PARENT)).toHaveLength(0);
    const trace = await db('journal_notifications').where({ statut: 'annule' }).first();
    expect(trace).toMatchObject({ code_erreur: 'PLAFOND_SMS', type_notif: 'nouvelle_note', segments: 0, destinataire_id: parent.id });
  });

  test('au plafond : l\'absence (urgence) part quand même', async () => {
    await consommer(100);

    const r = await traiterNotification(jobAbsence());

    expect(r).toMatchObject({ statut: 'envoye' });
    expect(smsVers(TEL_PARENT)).toHaveLength(1);
  });

  test('à 150 % du plafond (butoir) : même l\'absence est bloquée', async () => {
    await consommer(150);

    const r = await traiterNotification(jobAbsence());

    expect(r).toMatchObject({ statut: 'skip', raison: 'butoir_atteint' });
    expect(smsVers(TEL_PARENT)).toHaveLength(0);
  });

  test('plafond 0 = illimité', async () => {
    await fixerPlafond(0);
    await consommer(30000);

    const r = await traiterNotification(jobNote());

    expect(r.statut).toBe('envoye');
  });

  test('chaque envoi enregistre ses segments, qui comptent ensuite dans la consommation', async () => {
    envoyerSMS.mockResolvedValue({ succes: true, messageIds: ['m'], segments: 2 });

    await traiterNotification(jobNote());

    const ligne = await db('journal_notifications').where({ statut: 'envoye' }).first();
    expect(ligne.segments).toBe(2);
    expect((await consommationMois(db, seed.etablissement.id)).utilises).toBe(2);
  });
});

describe('alertes au directeur', () => {
  test('80 % : le directeur est prévenu UNE fois ; 100 % : une seconde fois ; pas de répétition', async () => {
    await fixerPlafond(10);
    await consommer(7);

    await traiterNotification(jobNote());                 // 8/10 = 80 %
    expect(smsVers(TEL_DIR)).toHaveLength(1);
    expect(smsVers(TEL_DIR)[0][1]).toMatch(/80%/);

    await traiterNotification(jobNote());                 // 9/10 : déjà prévenu pour 80 %
    expect(smsVers(TEL_DIR)).toHaveLength(1);

    await traiterNotification(jobNote());                 // 10/10 = 100 %
    expect(smsVers(TEL_DIR)).toHaveLength(2);
    expect(smsVers(TEL_DIR)[1][1]).toMatch(/atteint/);

    await traiterNotification(jobAbsence());              // 11/10 (urgence) : pas de nouvelle alerte
    expect(smsVers(TEL_DIR)).toHaveLength(2);

    const p = await db('politique_securite').where({ etablissement_id: seed.etablissement.id }).first();
    expect(p.sms_alerte_palier).toBe(100);
  });

  test('deux envois simultanés au franchissement du seuil : un seul SMS d\'alerte', async () => {
    await fixerPlafond(10);
    await consommer(7);

    await Promise.all([traiterNotification(jobNote()), traiterNotification(jobNote())]);

    expect(smsVers(TEL_DIR).length).toBeLessThanOrEqual(2);       // 8/10 puis 9/10 : un seul palier (80 %)
    expect(smsVers(TEL_DIR).filter(([, m]) => /80%/.test(m))).toHaveLength(1);
  });

  test('un nouveau mois repart de zéro (le palier du mois précédent ne masque pas l\'alerte)', async () => {
    await fixerPlafond(10);
    await db('politique_securite').where({ etablissement_id: seed.etablissement.id })
      .update({ sms_alerte_mois: '2000-01', sms_alerte_palier: 100 });
    await consommer(7);

    await traiterNotification(jobNote());

    expect(smsVers(TEL_DIR)).toHaveLength(1);
  });
});

describe('endpoints', () => {
  test('GET /notifications/sms/consommation : usage du mois et état des blocages', async () => {
    await fixerPlafond(100);
    await consommer(100);

    const res = await requestNotif.get('/api/v1/notifications/sms/consommation').set('Authorization', `Bearer ${tokenDir}`).expect(200);

    expect(res.body.data).toMatchObject({
      utilises: 100, plafond: 100, pourcentage: 100, notes_et_bulletins_bloques: true, urgences_bloquees: false,
    });
  });

  test('PUT /notifications/sms/plafond : le directeur règle le plafond, les alertes repartent de zéro', async () => {
    await db('politique_securite').where({ etablissement_id: seed.etablissement.id }).update({ sms_alerte_palier: 100, sms_alerte_mois: '2026-10' });

    const res = await requestNotif.put('/api/v1/notifications/sms/plafond').set('Authorization', `Bearer ${tokenDir}`).send({ plafond: 5000 }).expect(200);

    expect(res.body.data.plafond).toBe(5000);
    const p = await db('politique_securite').where({ etablissement_id: seed.etablissement.id }).first();
    expect(p).toMatchObject({ sms_plafond_mensuel: 5000, sms_alerte_palier: 0, sms_alerte_mois: null });
  });

  test.each([[-1], [1.5], ['beaucoup'], [100001]])('PUT plafond invalide (%p) → 422', async (valeur) => {
    await requestNotif.put('/api/v1/notifications/sms/plafond').set('Authorization', `Bearer ${tokenDir}`).send({ plafond: valeur }).expect(422);
  });

  test('un enseignant ne peut pas modifier le plafond (403)', async () => {
    await requestNotif.put('/api/v1/notifications/sms/plafond').set('Authorization', `Bearer ${tokenEns}`).send({ plafond: 1 }).expect(403);
  });
});
