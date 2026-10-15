/**
 * Parcours « école complète » côté MOBILE.
 *
 * Fait tourner le VRAI code de l'application (client HTTP, authStore, syncService, base locale) contre un VRAI
 * backend PostgreSQL, comme le parcours web (dashboard/tests/specs/parcours-ecole.spec.js) : même jeu de profils
 * (dashboard/tests/data/profils-parcours.js). Seuls l'écran (React Native) et le moteur SQLite natif sont remplacés :
 * la base locale est better-sqlite3 avec le schéma de production (SCHEMA_SQL), le réseau est un interrupteur.
 *
 * Les écrans ne sont pas montés : les étapes reprennent, appel pour appel, ce que font
 * app/(app)/enseignant/notes-saisie.tsx et appel.tsx (voir les renvois dans chaque étape).
 *
 *   cd backend && npm start                      # :3010, base dédiée (voir dashboard/tests/README.md)
 *   cd mobile && npm run test:parcours           # POSTGRES_* exportées : le code SMS est remplacé en base avec psql
 *
 * Variable : PARCOURS_API_URL (défaut http://localhost:3010/api/v1).
 */

// Doit précéder toute importation de client.ts (BASE_URL est lue au chargement du module)
process.env.EXPO_PUBLIC_API_URL = process.env.PARCOURS_API_URL || 'http://localhost:3010/api/v1';
const API = process.env.EXPO_PUBLIC_API_URL;

// ── Réseau : interrupteur « mode avion » ─────────────────────────
let mockEnLigne = true;
jest.mock('expo-network', () => ({
  getNetworkStateAsync: async () => ({ isConnected: mockEnLigne, isInternetReachable: mockEnLigne }),
}));

// Hors ligne, fetch échoue comme sur un téléphone sans réseau
const fetchReel = global.fetch;
global.fetch = ((...args: Parameters<typeof fetch>) =>
  mockEnLigne ? fetchReel(...args) : Promise.reject(new TypeError('Network request failed'))) as typeof fetch;

// Moteur SQLite natif remplacé par better-sqlite3 (même surface async)
jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: async () => require('../helpers/sqliteRealMock').creerAdaptateurSqliteReel(':memory:'),
}));

// Module natif : l'implémentation fournie par jest-expo ne renvoie rien
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));

import { execFileSync } from 'child_process';
import { randomUUID } from 'crypto';

/* eslint-disable @typescript-eslint/no-var-requires */
const { creerJeuDeProfils } = require('../../../dashboard/tests/data/profils-parcours.js');
const { api, authApi, enseignantApi, syncApi } = require('../../src/services/api/client');
const { useAuthStore } = require('../../src/stores/authStore');
const { syncService } = require('../../src/services/sync/syncService');
const {
  ouvrirBD, getDB, sauvegarderNoteLocale, sauvegarderPresenceLocale, populerPresencesLocales,
  ajouterOperationPendante, getOperationsPendantes,
} = require('../../src/services/storage/database');
const SecureStore = require('expo-secure-store');

jest.setTimeout(60000);

// expect(valeur, message) : Jest n'accepte pas de message ; il est ajouté en tête de l'erreur pour savoir quoi regarder
const expectJest = (global as any).expect;
function expect(valeur: any, message?: string): any {
  const annoter = (e: any) => { if (message && e instanceof Error) e.message = `${message}\n${e.message}`; return e; };
  const envelopper = (cible: any): any => new Proxy(cible, {
    get(t, p) {
      const v = t[p];
      if (typeof v === 'function') {
        return (...args: any[]) => {
          try { const r = v.apply(t, args); return r && typeof r.then === 'function' ? r.catch((e: any) => { throw annoter(e); }) : r; }
          catch (e) { throw annoter(e); }
        };
      }
      return v && typeof v === 'object' ? envelopper(v) : v;
    },
  });
  return envelopper(expectJest(valeur));
}
Object.assign(expect, expectJest);

const jeu = creerJeuDeProfils();
const aujourdhui = new Date().toISOString().slice(0, 10);
const etat: Record<string, any> = {};

// ── Appels HTTP « côté directeur », pour préparer l'école (hors périmètre de ce que teste le mobile) ──
async function http(method: string, chemin: string, corps?: object, jeton?: string) {
  const res = await fetchReel(`${API}${chemin}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(jeton ? { Authorization: `Bearer ${jeton}` } : {}) },
    ...(corps ? { body: JSON.stringify(corps) } : {}),
  });
  const json: any = await res.json().catch(() => ({}));
  return { statut: res.status, json, data: json.data };
}
const dir = async (method: string, chemin: string, corps?: object) => {
  const r = await http(method, chemin, corps, etat.tokenDirecteur);
  if (r.statut >= 400) throw new Error(`${method} ${chemin} → ${r.statut} ${JSON.stringify(r.json)}`);
  return r.data;
};

// Les codes SMS ne sont pas lisibles : on les remplace en base par un code connu (comme le parcours web)
const psqlDisponible = (() => { try { execFileSync('psql', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
function fixerCodeSms(telephone: string, code: string) {
  if (!/^\+?\d+$/.test(telephone) || !/^\d{6}$/.test(code)) throw new Error('numéro ou code invalide');
  const sql = `UPDATE otp_verifications SET code_hash = encode(sha256('${code}'::bytea), 'hex') ` +
    `WHERE utilise = false AND utilisateur_id IN (SELECT id FROM utilisateurs WHERE telephone = '${telephone}')`;
  execFileSync('psql', ['-h', process.env.POSTGRES_HOST || 'localhost', '-p', process.env.POSTGRES_PORT || '5432',
    '-U', process.env.POSTGRES_USER || 'ecole_user', '-d', process.env.POSTGRES_DB || 'ecole_manager',
    '-v', 'ON_ERROR_STOP=1', '-c', sql], { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD || '' }, stdio: 'ignore' });
}

/** Exécute du SQL sur la base de test (psql) */
function sql(requete: string) {
  execFileSync('psql', ['-h', process.env.POSTGRES_HOST || 'localhost', '-p', process.env.POSTGRES_PORT || '5432',
    '-U', process.env.POSTGRES_USER || 'ecole_user', '-d', process.env.POSTGRES_DB || 'ecole_manager',
    '-v', 'ON_ERROR_STOP=1', '-c', requete], { env: { ...process.env, PGPASSWORD: process.env.POSTGRES_PASSWORD || '' }, stdio: 'ignore' });
}

// ── Un « téléphone » = une base locale neuve + un magasin d'authentification vide ──
async function nouvelAppareil() {
  mockEnLigne = true;
  api.setToken(null);
  api.setRefreshToken(null);
  for (const cle of ['jwt_token', 'refresh_token', 'session']) await SecureStore.deleteItemAsync(cle);
  useAuthStore.setState({ session: null, token: null, estConnecte: false, chargement: true });
  await ouvrirBD();
}
const lignes = (sql: string, params: any[] = []) => getDB().getAllAsync(sql, params) as Promise<any[]>;
const nomsLocaux = async (table = 'eleves') =>
  (await lignes(`SELECT prenom, nom FROM ${table} ORDER BY nom, prenom`)).map((e) => `${e.prenom} ${e.nom}`);

const enseignant = (nom: string) => jeu.enseignants.find((e: any) => e.nom === nom);
const eleve = (prenom: string) => jeu.eleves.find((e: any) => e.prenom === prenom);
const evaluation = (titre: string) => jeu.evaluations.find((e: any) => e.titre.startsWith(titre));

/** Connexion d'un enseignant comme l'écran de connexion + l'écran de changement de mot de passe */
async function connecterEnseignant(e: any) {
  await useAuthStore.getState().connexionMDP({
    identifiant: e.telephone, mot_de_passe: e.mdp, etablissement_code: etat.codeEtablissement,
  });
  expect(useAuthStore.getState().session.doit_changer_mdp, 'mot de passe provisoire attendu').toBe(true);

  // Tant que le mot de passe n'est pas changé, le serveur refuse tout le reste (règle 8)
  await expect(syncApi.telecharger()).rejects.toMatchObject({ code: 'MDP_CHANGEMENT_REQUIS' });

  await authApi.changerMotDePasse({ mot_de_passe_actuel: e.mdp, nouveau_mot_de_passe: etat.nouveauMdp });
  await useAuthStore.getState().mdpChange();
  expect(useAuthStore.getState().session.doit_changer_mdp).toBe(false);
}

// ══════════════════════════════════════════════════════════════════
// Préparation : l'école existe déjà (créée par le directeur depuis le web)
// ══════════════════════════════════════════════════════════════════

beforeAll(async () => {
  etat.nouveauMdp = 'Zebre2026Pluie';

  const creation = await http('POST', '/inscription', {
    etablissement: { nom: jeu.ecole.nom, ville: jeu.ecole.ville },
    directeur: { nom: jeu.directeur.nom, prenom: jeu.directeur.prenom, email: jeu.directeur.email,
                 telephone: jeu.directeur.telephone, mot_de_passe: jeu.directeur.mdp },
  });
  expect(creation.statut, JSON.stringify(creation.json)).toBe(201);
  etat.codeEtablissement = creation.data.etablissement.code_officiel;
  const connexion = await http('POST', '/auth/connexion', {
    identifiant: jeu.directeur.email, mot_de_passe: jeu.directeur.mdp, etablissement_code: etat.codeEtablissement });
  etat.tokenDirecteur = connexion.data.token;

  for (const m of jeu.matieres) await dir('POST', '/configs/matieres', { nom: m.nom, nom_court: m.court, code: m.code });
  const matieres = await dir('GET', '/configs/matieres');
  const niveaux = await dir('GET', '/niveaux');
  for (const c of jeu.classes) {
    const niveau = niveaux.find((n: any) => n.nom === c.niveau);
    await dir('POST', '/classes', { niveau_id: niveau.id, nom: c.lettre, salle_principale: c.salle, effectif_max: c.effectif });
  }
  const classes = await dir('GET', '/classes');
  const classeId = (libelle: string) =>
    classes.find((c: any) => `${c.niveau} ${c.nom}` === libelle || `${c.niveau_nom} ${c.nom}` === libelle).id;
  etat.classeId = classeId;

  for (const e of jeu.enseignants) {
    const cree = await dir('POST', '/enseignants', {
      nom: e.nom, prenom: e.prenom, telephone: e.telephone, email: e.email,
      specialite: e.specialite, type_contrat: e.contrat, mot_de_passe: e.mdp,
    });
    e.enseignantId = cree.enseignant_id;
    for (const a of e.affectations) {
      await dir('POST', '/affectations', {
        enseignant_id: e.enseignantId, classe_id: classeId(a.classe),
        matiere_id: matieres.find((m: any) => m.nom === a.matiere).id, est_titulaire: a.titulaire,
      });
    }
  }
  for (const el of jeu.eleves) {
    await dir('POST', '/eleves', {
      prenom: el.prenom, nom: el.nom, genre: el.genre, date_naissance: el.naissance, classe_id: classeId(el.classe),
      parent: { nom: el.parent.nom, prenom: el.parent.prenom, telephone: el.parent.telephone, lien: el.parent.lien },
    });
  }

  // Évaluations : créées par le directeur ; les notes, elles, seront saisies depuis le mobile
  const annee = await dir('GET', '/annees-scolaires/courante');
  const affectations: Record<string, string> = {};
  for (const c of jeu.classes) {
    const id = classeId(`${c.niveau} ${c.lettre}`);
    for (const a of await dir('GET', `/classes/${id}/affectations`)) affectations[`${c.niveau} ${c.lettre} | ${a.matiere}`] = a.affectation_id;
  }
  for (const ev of jeu.evaluations) {
    const cree = await dir('POST', '/evaluations', {
      affectation_id: affectations[`${ev.classe} | ${ev.matiere}`], periode_id: annee.periodes[0].id,
      type: ev.type, numero: ev.numero, titre: ev.titre, note_max: ev.noteMax, date_evaluation: ev.date,
    });
    ev.id = cree.id;
  }

  // Un créneau d'emploi du temps pour l'appel : Mathématiques 6ème A, lundi, première plage
  // Une école neuve reçoit des plages horaires par défaut (migration 026)
  const plages = await dir('GET', '/plages-horaires');
  expect(plages.filter((p: any) => !p.est_pause).length).toBeGreaterThanOrEqual(4);
  const affMaths6A = affectations['6ème A | Mathématiques'];
  const creneau = await dir('POST', '/edt/creneaux', {
    classe_id: classeId('6ème A'), affectation_id: affMaths6A,
    plage_id: plages.find((p: any) => !p.est_pause).id, jour_semaine: 1, salle: 'Salle 1',
  });
  etat.creneauId = creneau.id;
  etat.affMaths6A = affMaths6A;
  etat.plagesLibres = plages.filter((p: any) => !p.est_pause).map((p: any) => p.id);
  etat.classe6A = classeId('6ème A');
});

afterAll(async () => { mockEnLigne = true; });

// ══════════════════════════════════════════════════════════════════
// Enseignante de mathématiques : Aïssatou Sow (6ème A + 5ème B)
// ══════════════════════════════════════════════════════════════════

describe('Parcours mobile : enseignants', () => {
  test('M1. première connexion avec le mot de passe provisoire, puis changement obligatoire', async () => {
    await nouvelAppareil();
    await connecterEnseignant(enseignant('Sow'));
    expect(useAuthStore.getState().session.etablissement_nom).toBe(jeu.ecole.nom);
    expect(useAuthStore.getState().session.role).toBe('enseignant');
  });

  test('M2. la synchronisation descendante ne charge que les élèves de SES classes', async () => {
    const res = await syncService.syncDescendante();
    expect(res, JSON.stringify(res)).toMatchObject({ succes: true });

    expect(await nomsLocaux()).toEqual(
      jeu.eleves.map((e: any) => `${e.prenom} ${e.nom}`).sort((a: string, b: string) => {
        const [pa, ...na] = a.split(' '); const [pb, ...nb] = b.split(' ');
        return `${na.join(' ')} ${pa}`.localeCompare(`${nb.join(' ')} ${pb}`);
      }),
    );
    // Ses évaluations (Maths 6A, Maths 5B, brouillon Maths 5B), pas celle de Français
    const titres = (await lignes('SELECT matiere, classe FROM evaluations')).map((e) => `${e.classe} | ${e.matiere}`).sort();
    expect(titres).toEqual(['5ème B | Mathématiques', '5ème B | Mathématiques', '6ème A | Mathématiques']);
    // Ses affectations (matière × classe) et les périodes de l'année, nécessaires pour créer une évaluation
    expect((await lignes('SELECT classe, matiere FROM affectations ORDER BY classe')).map((a) => `${a.classe} | ${a.matiere}`))
      .toEqual(['5ème B | Mathématiques', '6ème A | Mathématiques']);
    expect((await lignes('SELECT numero FROM periodes ORDER BY numero')).length).toBeGreaterThanOrEqual(2);
    // Son emploi du temps contient le créneau créé par le directeur
    expect((await lignes('SELECT id FROM edt')).map((r) => r.id)).toContain(etat.creneauId);
  });

  test('M3. notes saisies HORS LIGNE : mises en file, rien n\'arrive au serveur, tout part au retour du réseau', async () => {
    const ev = evaluation('Devoir 1 Maths 6A');
    const locales = await lignes('SELECT id FROM evaluations WHERE id = ?', [ev.id]);
    expect(locales, 'évaluation absente de la base locale').toHaveLength(1);
    const inscriptions = Object.fromEntries((await lignes('SELECT id, prenom, nom, inscription_id FROM eleves'))
      .map((r) => [`${r.prenom} ${r.nom}`, r]));

    mockEnLigne = false;
    // notes-saisie.tsx → sauvegarder() : écriture locale d'abord, puis envoi ; en échec, mise en file
    const notes = Object.entries(ev.notes).map(([nom, valeur]) => ({
      id: randomUUID(), evaluation_id: ev.id, eleve_id: inscriptions[nom].id, inscription_id: inscriptions[nom].inscription_id,
      valeur: valeur as number, est_absent: false, absence_justifiee: false,
    }));
    for (const n of notes) await sauvegarderNoteLocale(n);
    await expect(enseignantApi.saisirNotes(ev.id, notes)).rejects.toMatchObject({ code: 'HORS_LIGNE' });
    await ajouterOperationPendante('notes.saisir_batch', { evaluation_id: ev.id, notes });

    expect(await syncService.syncMontante()).toEqual({ envoyees: 0, echecs: 0 });          // toujours hors ligne
    expect((await lignes('SELECT * FROM notes WHERE synced = 0')).length).toBe(notes.length);
    const cote = await dir('GET', `/evaluations/${ev.id}/notes`);
    expect(cote.filter((n: any) => n.valeur != null), 'le serveur ne doit rien avoir reçu').toHaveLength(0);

    mockEnLigne = true;                                                                         // retour du réseau
    const envoi = await syncService.syncMontante();
    expect(envoi, JSON.stringify(await lignes('SELECT type, statut, erreur_msg FROM operations_pending'))).toMatchObject({ echecs: 0 });
    expect(envoi.envoyees).toBeGreaterThan(0);

    const recu = Object.fromEntries((await dir('GET', `/evaluations/${ev.id}/notes`))
      .filter((n: any) => n.valeur != null).map((n: any) => [`${n.prenom} ${n.nom}`, Number(n.valeur)]));
    expect(recu).toEqual(ev.notes);
  });

  test('M4. notes saisies EN LIGNE (5ème B), dont un brouillon jamais publié', async () => {
    for (const titre of ['Devoir 1 Maths 5B', 'Devoir 2 Maths 5B']) {
      const ev = evaluation(titre);
      const eleves = Object.fromEntries((await lignes('SELECT id, prenom, nom, inscription_id FROM eleves'))
        .map((r) => [`${r.prenom} ${r.nom}`, r]));
      const notes = Object.entries(ev.notes).map(([nom, valeur]) => ({
        id: randomUUID(), evaluation_id: ev.id, eleve_id: eleves[nom].id, inscription_id: eleves[nom].inscription_id,
        valeur: valeur as number, est_absent: false, absence_justifiee: false,
      }));
      for (const n of notes) await sauvegarderNoteLocale(n);
      await enseignantApi.saisirNotes(ev.id, notes);                                        // pas d'exception : en ligne
      await getDB().runAsync('UPDATE notes SET synced=1 WHERE evaluation_id=?', [ev.id]);

      const recu = Object.fromEntries((await dir('GET', `/evaluations/${ev.id}/notes`))
        .filter((n: any) => n.valeur != null).map((n: any) => [`${n.prenom} ${n.nom}`, Number(n.valeur)]));
      expect(recu, titre).toEqual(ev.notes);
    }
  });

  test('M5. appel : élève absent marqué hors ligne, envoyé au retour du réseau', async () => {
    // appel.tsx → initialiserAppel() : ouverture de l'appel puis présences de la classe
    const ouvert = await enseignantApi.ouvrirAppel({ emploi_du_temps_id: etat.creneauId, date_cours: aujourdhui });
    etat.appelId = ouvert.appel_id || ouvert.id;
    expect(etat.appelId).toBeTruthy();
    const cours = await enseignantApi.getCoursAppel(etat.creneauId, aujourdhui);
    expect(cours.eleves.map((e: any) => `${e.prenom} ${e.nom}`).sort()).toEqual(['Awa Traoré', 'Fatou Ndiaye']);
    await getDB().runAsync('INSERT INTO appels (id, cours_id, date_cours, classe, statut) VALUES (?,?,?,?,?)',
      [etat.appelId, etat.creneauId, aujourdhui, '6ème A', 'ouvert']);
    await populerPresencesLocales(etat.appelId, cours.eleves);

    // appel.tsx → sauvegarder() sans réseau : écriture locale + file d'attente pour les absents
    mockEnLigne = false;
    const awa = (await lignes('SELECT * FROM presences WHERE eleve_prenom = ?', ['Awa']))[0];
    await sauvegarderPresenceLocale({ ...awa, statut: 'absent' });
    await ajouterOperationPendante('presences.saisir', { appel_id: etat.appelId, inscription_id: awa.inscription_id, statut: 'absent' });
    await expect(enseignantApi.saisirPresences(etat.appelId, [{ inscription_id: awa.inscription_id, statut: 'absent' }]))
      .rejects.toMatchObject({ code: 'HORS_LIGNE' });

    mockEnLigne = true;
    const envoi = await syncService.syncMontante();
    expect(envoi, JSON.stringify(await lignes('SELECT type, statut, erreur_msg FROM operations_pending'))).toMatchObject({ echecs: 0 });

    const cote = await enseignantApi.getCoursAppel(etat.creneauId, aujourdhui);                // relu côté serveur, avec son propre jeton
    const statuts = Object.fromEntries(cote.eleves.map((e: any) => [e.prenom, e.statut]));
    expect(statuts.Awa).toBe('absent');
    expect(statuts.Fatou).not.toBe('absent');
  });

  test('M5b. synchronisation suivante : incrémentale, sans doublon de notes ni perte du reste', async () => {
    const espion = jest.spyOn(syncApi, 'telecharger');
    const res = await syncService.syncDescendante();
    expect(res, JSON.stringify(res)).toMatchObject({ succes: true });

    // La date de dernière synchro est enregistrée et utilisée : plus de retéléchargement complet
    expect((await lignes('SELECT derniere_sync FROM session'))[0]?.derniere_sync, 'ligne session absente').toBeTruthy();
    const res2 = await syncService.syncDescendante();
    expect(res2).toMatchObject({ succes: true });
    expect(espion.mock.calls[1][0], 'la 2e synchro doit envoyer la date de la précédente').toBeTruthy();
    espion.mockRestore();

    // Un envoi partiel ne doit rien effacer : l'emploi du temps est toujours là...
    expect((await lignes('SELECT id FROM edt')).map((r) => r.id)).toContain(etat.creneauId);
    // ...y compris quand UN SEUL créneau change : le serveur renvoie l'emploi du temps entier, le mobile le remplace
    const second = await dir('POST', '/edt/creneaux', {
      classe_id: etat.classe6A, affectation_id: etat.affMaths6A, plage_id: etat.plagesLibres[1], jour_semaine: 2, salle: 'Salle 1',
    });
    await syncService.syncDescendante();
    expect((await lignes('SELECT id FROM edt')).map((r) => r.id).sort()).toEqual([etat.creneauId, second.id].sort());

    // notes-saisie.tsx lit les notes par élève (jointure sur eleves.id) : une seule ligne par élève, avec SA note
    const ev = evaluation('Devoir 1 Maths 6A');
    const lues = await lignes(
      `SELECT e.prenom, e.nom, n.valeur FROM eleves e JOIN notes n ON n.eleve_id = e.id WHERE n.evaluation_id = ?`, [ev.id]);
    expect(lues).toHaveLength(Object.keys(ev.notes).length);
    expect(Object.fromEntries(lues.map((l) => [`${l.prenom} ${l.nom}`, Number(l.valeur)]))).toEqual(ev.notes);

    // Tout ce qui est parti n'est plus « en attente » (compteur de notes à envoyer)
    expect(await lignes('SELECT id FROM notes WHERE synced = 0')).toHaveLength(0);
    expect(await lignes('SELECT id FROM presences WHERE synced = 0')).toHaveLength(0);
  });

  test('M5c. évaluation créée hors ligne puis en ligne : même identifiant partout, numéros qui se suivent', async () => {
    const { creerEvaluationMobile } = require('../../src/services/evaluations/creerEvaluation');
    const affectation = (await lignes(`SELECT id FROM affectations WHERE classe = '6ème A'`))[0].id;
    const champs = { affectation_id: affectation, type: 'interrogation', titre: 'Interro hors ligne', date_evaluation: aujourdhui, note_max: 10 };

    mockEnLigne = false;
    const horsLigne = await creerEvaluationMobile(champs);
    expect(horsLigne.enLigne).toBe(false);
    expect((await lignes('SELECT type FROM operations_pending WHERE statut = ?', ['en_attente'])).map((o) => o.type))
      .toContain('evaluations.creer');

    mockEnLigne = true;
    const envoi = await syncService.syncMontante();
    expect(envoi, JSON.stringify(await lignes('SELECT type, statut, erreur_msg FROM operations_pending'))).toMatchObject({ echecs: 0 });

    const cote = await dir('GET', '/evaluations?limite=100');
    const creee = cote.find((e: any) => e.id === horsLigne.id);
    expect(creee, 'évaluation créée hors ligne absente du serveur').toBeTruthy();
    expect(creee).toMatchObject({ type: 'interrogation', titre: 'Interro hors ligne', numero: 1, matiere: 'Mathématiques' });
    expect((await lignes('SELECT matiere, classe FROM evaluations WHERE id = ?', [horsLigne.id]))[0])
      .toEqual({ matiere: 'Mathématiques', classe: '6ème A' });

    // En ligne : créée directement, numéro suivant
    const enLigne = await creerEvaluationMobile({ ...champs, titre: 'Interro en ligne' });
    expect(enLigne.enLigne).toBe(true);
    expect((await dir('GET', '/evaluations?limite=100')).find((e: any) => e.id === enLigne.id)).toMatchObject({ numero: 2 });

    // Un refus du serveur n'est pas mis en file et ne laisse pas d'évaluation fantôme sur le téléphone
    const avant = (await lignes('SELECT id FROM evaluations')).length;
    await expect(creerEvaluationMobile({ ...champs, affectation_id: randomUUID() })).rejects.toThrow();
    expect(await lignes('SELECT id FROM evaluations')).toHaveLength(avant);
  });

  test('M6. relance de l\'application : la session est rouverte sans nouvelle connexion', async () => {
    useAuthStore.setState({ session: null, token: null, estConnecte: false, chargement: true });
    api.setToken(null);
    await useAuthStore.getState().chargerSession();
    expect(useAuthStore.getState().estConnecte).toBe(true);
    expect(useAuthStore.getState().session.nom_complet).toContain('Sow');
    await expect(syncApi.telecharger()).resolves.toBeTruthy();                              // le jeton restauré est utilisable
  });

  test('M7. jeton expiré : le client se renouvelle seul (refresh) puis rejoue la requête', async () => {
    const ancien = useAuthStore.getState().token;
    api.setToken('jeton.expire.invalide');
    await expect(syncApi.telecharger()).resolves.toBeTruthy();
    expect(useAuthStore.getState().token, 'le nouveau jeton doit être conservé').not.toBe(ancien);
  });

  test('M8. l\'autre enseignant ne voit que sa classe (Français 6ème A) et saisit ses notes', async () => {
    await useAuthStore.getState().deconnexion();
    expect(await lignes('SELECT id FROM eleves')).toHaveLength(0);                          // base locale vidée
    await nouvelAppareil();
    await connecterEnseignant(enseignant('Ba'));

    expect((await syncService.syncDescendante()).succes).toBe(true);
    expect(await nomsLocaux()).toEqual(['Fatou Ndiaye', 'Awa Traoré'].sort((a, b) => a.split(' ')[1].localeCompare(b.split(' ')[1])));
    expect((await lignes('SELECT matiere, classe FROM evaluations')).map((e) => `${e.classe} | ${e.matiere}`))
      .toEqual(['6ème A | Français']);

    const ev = evaluation('Composition 1 Fr 6A');
    const eleves = Object.fromEntries((await lignes('SELECT id, prenom, nom, inscription_id FROM eleves'))
      .map((r) => [`${r.prenom} ${r.nom}`, r]));
    const notes = Object.entries(ev.notes).map(([nom, valeur]) => ({
      id: randomUUID(), evaluation_id: ev.id, eleve_id: eleves[nom].id, inscription_id: eleves[nom].inscription_id,
      valeur: valeur as number, est_absent: false, absence_justifiee: false,
    }));
    await enseignantApi.saisirNotes(ev.id, notes);

    // Une évaluation d'une autre matière lui est fermée
    await expect(enseignantApi.saisirNotes(evaluation('Devoir 1 Maths 5B').id, notes)).rejects.toMatchObject({ statusCode: expect.any(Number) });
    await useAuthStore.getState().deconnexion();
  });
});

// ══════════════════════════════════════════════════════════════════
// Parents : connexion par code SMS, puis synchronisation
// ══════════════════════════════════════════════════════════════════

describe('Parcours mobile : parents', () => {
  test('M9. publication par le directeur (hors mobile) : trois évaluations sur quatre', async () => {
    for (const ev of jeu.evaluations.filter((e: any) => e.publiee !== false)) await dir('PUT', `/evaluations/${ev.id}/publier`, {});
  });

  /** Connexion d'un parent comme parent-login : numéro → code SMS → session */
  async function connecterParent(parent: any) {
    await nouvelAppareil();
    await authApi.demanderOTP({ telephone: parent.telephone });
    fixerCodeSms(parent.telephone, '424242');
    const res = await useAuthStore.getState().connexionOTP({ telephone: parent.telephone, code: '424242' });
    expect(res).toEqual({ choixRequis: false });
    expect(useAuthStore.getState().session.role).toBe('parent');
  }
  const enfantsDe = (parent: any) => jeu.eleves.filter((e: any) => e.parent.telephone === parent.telephone);

  for (const cle of ['ndiaye', 'traore', 'fall']) {
    test(`M10. parent ${cle} : ses enfants, leurs notes publiées, aucun brouillon, aucun autre enfant`, async () => {
      test_skip_sans_psql();
      const parent = jeu.parents[cle];
      await connecterParent(parent);

      const res = await syncService.syncDescendante();
      expect(res, JSON.stringify(res)).toMatchObject({ succes: true });

      const enfants = enfantsDe(parent);
      expect((await nomsLocaux()).sort()).toEqual(enfants.map((e: any) => `${e.prenom} ${e.nom}`).sort());

      // Notes publiées de chaque enfant (la table locale en lecture seule du parent)
      const notesLocales = await lignes(
        `SELECT e.prenom, e.nom, n.matiere, n.valeur FROM notes_parent n JOIN eleves e ON e.id = n.eleve_id`);
      for (const el of enfants) {
        const nomComplet = `${el.prenom} ${el.nom}`;
        const attendues = jeu.evaluations
          .filter((ev: any) => ev.publiee !== false && ev.notes[nomComplet] !== undefined)
          .map((ev: any) => `${ev.matiere}:${ev.notes[nomComplet]}`).sort();
        const obtenues = notesLocales.filter((n) => `${n.prenom} ${n.nom}` === nomComplet)
          .map((n) => `${n.matiere}:${Number(n.valeur)}`).sort();
        expect(obtenues, `notes de ${nomComplet}`).toEqual(attendues);
      }
      const brouillon = evaluation('Devoir 2 Maths 5B');
      for (const v of Object.values(brouillon.notes)) {
        expect(notesLocales.map((n) => Number(n.valeur)), 'brouillon visible sur le téléphone du parent').not.toContain(v);
      }
    });
  }

  test('M11. le parent de l\'élève absente voit l\'absence, les autres non', async () => {
    test_skip_sans_psql();
    await connecterParent(jeu.parents.traore);
    await syncService.syncDescendante();
    const absences = await lignes('SELECT a.statut, e.prenom FROM absences a JOIN eleves e ON e.id = a.eleve_id');
    expect(absences.map((a) => `${a.prenom}:${a.statut}`)).toEqual(['Awa:absent']);

    await connecterParent(jeu.parents.ndiaye);
    await syncService.syncDescendante();
    expect(await lignes('SELECT * FROM absences')).toHaveLength(0);
  });

  test('M12. un parent n\'a aucun accès aux fonctions enseignant (saisie de notes, appels)', async () => {
    test_skip_sans_psql();
    await connecterParent(jeu.parents.fall);
    const ev = evaluation('Devoir 1 Maths 5B');
    await expect(enseignantApi.saisirNotes(ev.id, [{ eleve_id: randomUUID(), inscription_id: randomUUID(), valeur: 20, est_absent: false }]))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(enseignantApi.ouvrirAppel({ emploi_du_temps_id: etat.creneauId, date_cours: aujourdhui }))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('M13. la déconnexion efface les données de l\'enfant du téléphone', async () => {
    test_skip_sans_psql();
    await connecterParent(jeu.parents.ndiaye);
    await syncService.syncDescendante();
    expect((await lignes('SELECT id FROM eleves')).length).toBeGreaterThan(0);
    await useAuthStore.getState().deconnexion();
    for (const table of ['eleves', 'notes_parent', 'absences']) expect(await lignes(`SELECT id FROM ${table}`), table).toHaveLength(0);
    expect(useAuthStore.getState().estConnecte).toBe(false);
  });
});

describe('Parcours mobile : synchronisation incrémentale côté parent', () => {
  test('M14. une évaluation publiée APRÈS la dernière synchro arrive quand même chez le parent', async () => {
    test_skip_sans_psql();
    const brouillon = evaluation('Devoir 2 Maths 5B');
    const parent = jeu.parents.fall;
    await nouvelAppareil();
    await authApi.demanderOTP({ telephone: parent.telephone });
    fixerCodeSms(parent.telephone, '424242');
    await useAuthStore.getState().connexionOTP({ telephone: parent.telephone, code: '424242' });

    await syncService.syncDescendante();
    const valeurs = async () => (await lignes('SELECT valeur FROM notes_parent')).map((n) => Number(n.valeur)).sort((a, b) => a - b);
    expect(await valeurs()).toEqual([17]);                                             // le brouillon n'est pas là

    await dir('PUT', `/evaluations/${brouillon.id}/publier`, {});                      // publication après la synchro
    await syncService.syncDescendante();
    expect(await valeurs()).toEqual([5.75, 17]);                                       // arrivé, et l'ancien n'a pas bougé
  });
});

function test_skip_sans_psql() {
  if (!psqlDisponible) throw new Error('psql est nécessaire pour fixer le code SMS (variables POSTGRES_* de la base de test)');
}
