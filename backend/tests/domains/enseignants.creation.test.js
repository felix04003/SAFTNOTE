'use strict';

// POST /enseignants : téléphone normalisé, doublons explicites, mot de passe
// provisoire généré et changement obligatoire.

jest.mock('../../src/infrastructure/database/pool');
jest.mock('../../src/infrastructure/cache/redis', () => ({
  connectRedis: jest.fn(), getRedis: jest.fn(), getOrSet: jest.fn((k, fn) => fn()),
  invalidatePattern: jest.fn(), healthCheck: jest.fn(),
}));
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(), warn: jest.fn(), error: jest.fn(), http: jest.fn(), log: jest.fn(),
}));
jest.mock('../../src/middleware/auth.middleware', () => ({
  authentifier: (req, res, next) => {
    req.session = { ...require('../helpers/testApp').defaultSession };
    req.etablissement_id = req.session.etablissement_id;
    next();
  },
  autoriserRoles: () => (req, res, next) => next(),
}));
jest.mock('../../src/middleware/permission.middleware', () => ({
  exigerPermission: () => (req, res, next) => next(),
  isolerEtablissement: (req, res, next) => {
    if (req.session) req.etablissement_id = req.session.etablissement_id;
    next();
  },
}));

jest.mock('../../src/infrastructure/notifications/sms.service', () => ({
  envoyerMotDePasseProvisoire: jest.fn(),
  envoyerSMS: jest.fn(), envoyerOTP: jest.fn(),
}));

const request = require('supertest');
const bcrypt  = require('bcryptjs');
const { getDB } = require('../../src/infrastructure/database/pool');
const { mockQuery, createMockDB, IDS } = require('../helpers/mockKnex');
const { createTestApp } = require('../helpers/testApp');
const { validerMotDePasse } = require('../../src/utils/mot-de-passe');

const router = require('../../src/domains/02-acteurs/enseignants/enseignants.routes');
const app = createTestApp(router);

const { envoyerMotDePasseProvisoire } = require('../../src/infrastructure/notifications/sms.service');

const AUTRE_ETAB = '99999999-0000-0000-0000-000000000000';

describe('POST /enseignants', () => {
  let db;
  beforeEach(() => { db = createMockDB(); getDB.mockReturnValue(db); });

  // Ordre des accès base : pays, doublon téléphone (de l'établissement), [email déjà pris
  // dans l'établissement, email d'un autre membre du personnel], politique, puis la transaction
  function prepare({ doublonTel = null, doublonEmail = null, emailPersonnel = null, avecEmail = false } = {}) {
    db.mockReturnValueOnce(mockQuery({ pays: 'SN' }));
    db.mockReturnValueOnce(mockQuery(doublonTel));
    if (avecEmail) {
      db.mockReturnValueOnce(mockQuery(doublonEmail));
      db.mockReturnValueOnce(mockQuery(emailPersonnel));
    }
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 8 }));
  }

  test('crée le compte : téléphone en E.164, mot de passe généré conforme, changement obligatoire', async () => {
    prepare();
    const insUtilisateur = mockQuery(1);
    db.mockReturnValueOnce(insUtilisateur);                                  // INSERT utilisateurs
    db.mockReturnValueOnce(mockQuery([{ id: IDS.enseignant }]));             // INSERT enseignants
    db.mockReturnValueOnce(mockQuery({ id: 'role-ens' }));                   // SELECT rôle
    db.mockReturnValueOnce(mockQuery(1));                                    // INSERT utilisateur_roles

    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '77 999 00 01' }).expect(201);

    expect(res.body.data.mot_de_passe_genere).toBe(true);
    const insere = insUtilisateur.insert.mock.calls[0][0];
    expect(insere.telephone).toBe('+221779990001');
    expect(insere.mdp_a_changer).toBe(true);

    const provisoire = res.body.data.message.split('provisoire : ')[1];
    expect(provisoire).not.toContain('779990001');
    expect(validerMotDePasse(provisoire)).toBeNull();
    expect(await bcrypt.compare(provisoire, insere.mot_de_passe_hash)).toBe(true);
  });

  test('mot de passe fourni par le directeur : accepté s\'il est conforme, changement obligatoire aussi', async () => {
    prepare();
    const insUtilisateur = mockQuery(1);
    db.mockReturnValueOnce(insUtilisateur);
    db.mockReturnValueOnce(mockQuery([{ id: IDS.enseignant }]));
    db.mockReturnValueOnce(mockQuery({ id: 'role-ens' }));
    db.mockReturnValueOnce(mockQuery(1));

    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001', mot_de_passe: 'Tr0ubadour9' }).expect(201);

    expect(res.body.data.mot_de_passe_genere).toBe(false);
    expect(insUtilisateur.insert.mock.calls[0][0].mdp_a_changer).toBe(true);
  });

  test('mot de passe fourni faible → 422', async () => {
    await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001', mot_de_passe: '123456' }).expect(422);
  });

  test('téléphone inexploitable → 422', async () => {
    db.mockReturnValueOnce(mockQuery({ pays: 'SN' }));
    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: 'abcdefgh' }).expect(422);
    expect(res.body.erreur).toMatch(/invalide/);
  });

  test('doublon dans le MÊME établissement → message précis', async () => {
    prepare({ doublonTel: { id: 'x', etablissement_id: IDS.etablissement } });
    // le test s'arrête avant la politique : un mock inutilisé est sans effet
    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001' }).expect(422);
    expect(res.body.erreur).toMatch(/existe déjà dans votre établissement/);
  });

  test('le doublon de téléphone est cherché dans CET établissement seulement (le même numéro peut exister dans une autre école)', async () => {
    const chaineDoublon = mockQuery(null);
    db.mockReturnValueOnce(mockQuery({ pays: 'SN' }));
    db.mockReturnValueOnce(chaineDoublon);
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 8 }));
    db.mockReturnValueOnce(mockQuery(1));
    db.mockReturnValueOnce(mockQuery([{ id: IDS.enseignant }]));
    db.mockReturnValueOnce(mockQuery({ id: 'role-ens' }));
    db.mockReturnValueOnce(mockQuery(1));

    await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001' }).expect(201);

    expect(chaineDoublon.where).toHaveBeenCalledWith({ etablissement_id: IDS.etablissement });
    expect(chaineDoublon.whereIn).toHaveBeenCalledWith('telephone', expect.arrayContaining(['+221779990001']));
  });

  test('email déjà pris dans l\'établissement → 422 explicite', async () => {
    prepare({ doublonEmail: { id: 'y' }, avecEmail: true });
    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001', email: 'e@x.sn' }).expect(422);
    expect(res.body.erreur).toMatch(/cet email existe déjà/);
  });

  test('email d\'un membre du personnel d\'un AUTRE établissement → 422 (règle du 2026-10-07)', async () => {
    prepare({ emailPersonnel: { id: 'z', etablissement_id: AUTRE_ETAB }, avecEmail: true });
    const res = await request(app).post('/enseignants')
      .send({ nom: 'Cisse', prenom: 'Mame', telephone: '+221779990001', email: 'dir@autre.sn' }).expect(422);
    expect(res.body.erreur).toMatch(/membre du personnel d'un autre établissement/);
  });
});

describe('POST /enseignants — mot de passe provisoire par SMS', () => {
  let db;
  const ancienneCle = process.env.AT_API_KEY;

  beforeEach(() => {
    db = createMockDB(); getDB.mockReturnValue(db);
    envoyerMotDePasseProvisoire.mockReset();
    process.env.AT_API_KEY = 'cle-de-test';
  });
  afterAll(() => { if (ancienneCle === undefined) delete process.env.AT_API_KEY; else process.env.AT_API_KEY = ancienneCle; });

  function creationOk() {
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Lamine Gueye', pays: 'SN' }));
    db.mockReturnValueOnce(mockQuery(null));                                 // doublon téléphone
    db.mockReturnValueOnce(mockQuery({ mdp_longueur_min: 8 }));              // politique
    db.mockReturnValueOnce(mockQuery(1));                                    // INSERT utilisateurs
    db.mockReturnValueOnce(mockQuery([{ id: IDS.enseignant }]));             // INSERT enseignants
    db.mockReturnValueOnce(mockQuery({ id: 'role-ens' }));                   // rôle
    db.mockReturnValueOnce(mockQuery(1));                                    // INSERT utilisateur_roles
  }
  const creer = () => request(app).post('/enseignants').send({ nom: 'Cisse', prenom: 'Mame', telephone: '77 999 00 01' });

  test('SMS envoyé : le mot de passe n\'est PAS dans la réponse', async () => {
    creationOk();
    envoyerMotDePasseProvisoire.mockResolvedValue({ succes: true });

    const res = await creer().expect(201);

    expect(res.body.data.sms_envoye).toBe(true);
    const [tel, infos] = envoyerMotDePasseProvisoire.mock.calls[0];
    expect(tel).toBe('+221779990001');
    expect(infos.etablissementNom).toBe('Lycée Lamine Gueye');
    expect(validerMotDePasse(infos.motDePasse)).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain(infos.motDePasse);
  });

  test('SMS en échec : repli explicite — le mot de passe est renvoyé au directeur', async () => {
    creationOk();
    envoyerMotDePasseProvisoire.mockRejectedValue(new Error('AT API error 500'));

    const res = await creer().expect(201);

    expect(res.body.data.sms_envoye).toBe(false);
    const mdp = envoyerMotDePasseProvisoire.mock.calls[0][1].motDePasse;
    expect(res.body.data.message).toContain(mdp);
    expect(res.body.data.message).toMatch(/SMS n'a pas pu être envoyé/);
  });

  test('sans clé Africa\'s Talking (dev/test) : aucun envoi, repli explicite', async () => {
    delete process.env.AT_API_KEY;
    creationOk();

    const res = await creer().expect(201);

    expect(envoyerMotDePasseProvisoire).not.toHaveBeenCalled();
    expect(res.body.data.sms_envoye).toBe(false);
    expect(res.body.data.message).toMatch(/Mot de passe provisoire : \S{12}/);
  });
});

describe('POST /enseignants/:id/mot-de-passe-provisoire', () => {
  const { getRedis } = require('../../src/infrastructure/cache/redis');
  let db, redisDel;
  const ancienneCle = process.env.AT_API_KEY;

  beforeEach(() => {
    db = createMockDB(); getDB.mockReturnValue(db);
    redisDel = jest.fn().mockResolvedValue(1);
    getRedis.mockReturnValue({ del: redisDel });
    envoyerMotDePasseProvisoire.mockReset().mockResolvedValue({ succes: true });
    process.env.AT_API_KEY = 'cle-de-test';
  });
  afterAll(() => { if (ancienneCle === undefined) delete process.env.AT_API_KEY; else process.env.AT_API_KEY = ancienneCle; });

  const appeler = () => request(app).post(`/enseignants/${IDS.enseignant}/mot-de-passe-provisoire`);

  test('réémet un mot de passe provisoire : hash, drapeau, sessions fermées, caches purgés, SMS', async () => {
    const majUtilisateur = mockQuery(1);
    const majSessions = mockQuery(1);
    db.mockReturnValueOnce(mockQuery({ utilisateur_id: IDS.autreUtilisateur, telephone: '+221771110001' })); // cible
    db.mockReturnValueOnce(mockQuery({ nom: 'Lycée Alpha' }));                                               // établissement
    db.mockReturnValueOnce(mockQuery([{ id: 's1', token_hash: 'hash_s1' }]));                                // sessions
    db.mockReturnValueOnce(majUtilisateur);
    db.mockReturnValueOnce(majSessions);

    const res = await appeler().expect(200);

    expect(res.body.data).toMatchObject({ sms_envoye: true, sessions_fermees: 1 });
    const maj = majUtilisateur.update.mock.calls[0][0];
    expect(maj.mdp_a_changer).toBe(true);
    const mdp = envoyerMotDePasseProvisoire.mock.calls[0][1].motDePasse;
    expect(await bcrypt.compare(mdp, maj.mot_de_passe_hash)).toBe(true);
    expect(majSessions.update).toHaveBeenCalledWith(expect.objectContaining({ revoquee: true, motif_revocation: 'mot_de_passe_provisoire' }));
    expect(redisDel).toHaveBeenCalledWith('sess:hash_s1');
    expect(JSON.stringify(res.body)).not.toContain(mdp);
  });

  test('enseignant d\'un autre établissement ou inconnu → 404, aucun SMS', async () => {
    db.mockReturnValueOnce(mockQuery(null));
    await appeler().expect(404);
    expect(envoyerMotDePasseProvisoire).not.toHaveBeenCalled();
  });

  test('enseignant sans téléphone → 422', async () => {
    db.mockReturnValueOnce(mockQuery({ utilisateur_id: IDS.autreUtilisateur, telephone: null }));
    await appeler().expect(422);
  });
});

describe('error.middleware — contraintes d\'unicité (filet de sécurité)', () => {
  const errorHandler = require('../../src/middleware/error.middleware');
  function appeler(contrainte) {
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    errorHandler({ code: '23505', constraint: contrainte, detail: 'x' }, { method: 'POST', originalUrl: '/x' }, res, jest.fn());
    return res;
  }

  test('utilisateurs_etab_telephone_key (migration 024) → message téléphone « de cet établissement » + champ', () => {
    const res = appeler('utilisateurs_etab_telephone_key');
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'DOUBLON', champ: 'telephone', erreur: expect.stringMatching(/numéro de téléphone.*de cet établissement/),
    }));
  });

  test('ancien nom de contrainte (avant migration 024) → message téléphone + champ', () => {
    const res = appeler('utilisateurs_telephone_key');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DOUBLON', champ: 'telephone' }));
  });

  test('utilisateurs_etablissement_id_email_key → message email + champ', () => {
    const res = appeler('utilisateurs_etablissement_id_email_key');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ champ: 'email', erreur: expect.stringMatching(/email/) }));
  });

  test('contrainte inconnue → message générique inchangé', () => {
    const res = appeler('autre_contrainte');
    expect(res.json).toHaveBeenCalledWith({ succes: false, erreur: 'Cet enregistrement existe déjà', code: 'DOUBLON' });
  });
});
