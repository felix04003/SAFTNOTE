'use strict';

// Base PostgreSQL réelle : le worker de notifications retrouve le parent,
// envoie UN SMS et journalise (tâche 2.6). Les envois sont simulés ; tout le
// reste (requêtes, contraintes NOT NULL, journal) s'exécute pour de vrai.

jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerSMS: jest.fn(),
  envoyerOTP: jest.fn(),
}));
jest.mock('../../src/infrastructure/notifications/whatsapp.service', () => ({
  envoyerTemplate: jest.fn(),
}));

const {
  getTestDB, closeTestDB, truncateData, seedTestData, createIntegrationApp,
} = require('./helpers');
const { envoyerSMS } = require('../../src/infrastructure/notifications/sms.service');

let db, seed, parent, eleve, inscription, evaluationId, appelId, traiterNotification;

const job = (data) => ({ id: 'job-test', data, moveToDelayed: jest.fn() });
const journal = () => db('journal_notifications').where({ etablissement_id: seed.etablissement.id }).orderBy('created_at');

beforeAll(async () => {
  createIntegrationApp();                       // branche le pool sur la base de test
  ({ traiterNotification } = require('../../src/workers/notification.processor'));
  db = getTestDB();
  await truncateData();
  seed = await seedTestData();
  ({ eleve, inscription } = seed.eleves[0]);

  // Parent principal de l'élève, préférences ouvertes toute la journée
  [parent] = await db('utilisateurs').insert({
    etablissement_id: seed.etablissement.id, nom: 'Traoré', prenom: 'Kadiatou',
    telephone: '+221770000050', actif: true,
  }).returning('*');
  await db('parents_eleves').insert({
    parent_id: parent.id, eleve_id: eleve.id, lien: 'mere', est_contact_principal: true,
    peut_voir_notes: true, peut_voir_absences: true,
  });
  await db('notifications_preferences').insert({
    utilisateur_id: parent.id, canal_prefere: 'sms',
    heure_debut_notif: '00:00', heure_fin_notif: '23:59',
  });

  // Une évaluation publiée avec la note de l'élève
  const [matiere] = await db('matieres').insert({
    etablissement_id: seed.etablissement.id, nom: 'Mathématiques', code: 'MATH',
  }).returning('*');
  const [aff] = await db('affectations_enseignants').insert({
    enseignant_id: seed.enseignant.id, matiere_id: matiere.id,
    classe_id: seed.classe.id, annee_scolaire_id: seed.annee.id,
  }).returning('*');
  const [ev] = await db('evaluations').insert({
    affectation_id: aff.id, periode_id: seed.periodes[0].id, type: 'devoir', numero: 1,
    titre: 'Devoir 1', date_evaluation: '2024-11-15', note_max: 20, notes_publiees: true,
  }).returning('*');
  evaluationId = ev.id;
  await db('notes').insert({
    evaluation_id: ev.id, eleve_id: eleve.id, inscription_id: inscription.id, valeur: 14.5,
    saisie_par: seed.enseignantUser.id,
  });

  // Un appel pour le cas « absence »
  const [plage] = await db('plages_horaires').insert({
    etablissement_id: seed.etablissement.id, numero: 1, libelle: '1ère heure',
    heure_debut: '08:00', heure_fin: '09:00',
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
  envoyerSMS.mockReset().mockResolvedValue({ succes: true, messageIds: ['msg-1'], segments: 1 });
  await db('journal_notifications').del();
});

afterAll(async () => { await closeTestDB(); });

describe('worker de notifications sur base réelle', () => {
  test('nouvelle_note (une inscription) : un SMS au parent principal et une ligne de journal complète', async () => {
    const res = await traiterNotification(job({
      type_notif: 'nouvelle_note', evaluation_id: evaluationId, inscription_id: inscription.id,
      etablissement_id: seed.etablissement.id,
    }));

    expect(res).toMatchObject({ statut: 'envoye', canal: 'sms' });
    expect(envoyerSMS).toHaveBeenCalledTimes(1);
    const [tel, message] = envoyerSMS.mock.calls[0];
    expect(tel).toBe('+221770000050');
    expect(message).toContain('14.5');

    const lignes = await journal();
    expect(lignes).toHaveLength(1);
    expect(lignes[0]).toMatchObject({
      destinataire_id: parent.id, eleve_id: eleve.id, canal: 'sms', type_notif: 'nouvelle_note',
      statut: 'envoye', telephone: '+221770000050', provider_message_id: 'msg-1',
    });
  });

  test('absence : un SMS au parent principal, journalisé', async () => {
    const res = await traiterNotification(job({
      type_notif: 'absence', inscription_id: inscription.id, appel_id: appelId,
      etablissement_id: seed.etablissement.id,
    }));

    expect(res).toMatchObject({ statut: 'envoye' });
    expect(envoyerSMS).toHaveBeenCalledTimes(1);
    expect(envoyerSMS.mock.calls[0][1]).toContain('ABSENCE');
    expect(await journal()).toHaveLength(1);
  });

  test('si la journalisation échoue APRÈS l\'envoi, le job ne doit pas relancer un second SMS', async () => {
    // Panne de l'ÉCRITURE du journal seule (la lecture du plafond fonctionne) : le SMS est
    // déjà parti, un retry BullMQ le renverrait (et le facturerait)
    await db.raw(`CREATE OR REPLACE FUNCTION panne_journal() RETURNS trigger AS $$
                  BEGIN RAISE EXCEPTION 'panne simulée du journal'; END $$ LANGUAGE plpgsql`);
    await db.raw('CREATE TRIGGER trg_panne_journal BEFORE INSERT ON journal_notifications FOR EACH ROW EXECUTE FUNCTION panne_journal()');
    try {
      const res = await traiterNotification(job({
        type_notif: 'absence', inscription_id: inscription.id, appel_id: appelId,
        etablissement_id: seed.etablissement.id,
      }));
      expect(res.statut).toBe('envoye');          // pas d'exception => pas de retry
    } finally {
      await db.raw('DROP TRIGGER IF EXISTS trg_panne_journal ON journal_notifications');
    }
    expect(envoyerSMS).toHaveBeenCalledTimes(1);
  });

  test('si le plafond ne peut pas être lu (base indisponible), rien n\'est envoyé et le job échoue pour être rejoué', async () => {
    await db.raw('ALTER TABLE journal_notifications RENAME TO journal_notifications_x');
    try {
      await expect(traiterNotification(job({
        type_notif: 'absence', inscription_id: inscription.id, appel_id: appelId,
        etablissement_id: seed.etablissement.id,
      }))).rejects.toThrow();
    } finally {
      await db.raw('ALTER TABLE journal_notifications_x RENAME TO journal_notifications');
    }
    expect(envoyerSMS).not.toHaveBeenCalled();
  });
});
