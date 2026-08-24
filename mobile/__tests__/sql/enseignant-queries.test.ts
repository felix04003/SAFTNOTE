/**
 * Tests SQL réels — requêtes des écrans enseignant.
 *
 * Niveau A : vrai SQLite en mémoire (better-sqlite3), seedé avec le schéma réel
 * (SCHEMA_SQL depuis src/services/storage/database.ts). Ne PAS mocker expo-sqlite
 * ici — ce fichier ne doit jamais coexister avec un jest.mock('expo-sqlite').
 *
 * Ces tests valident la CORRECTION SQL contre un vrai schéma, contrairement aux
 * tests mockés existants qui renvoient [] quoi qu'il arrive.
 */

import {
  getClassesDepuisEdt,
  getNbElevesClasse,
  getNbAbsencesJourClasse,
  getMoyenneClasse,
  getSparklineAbsences,
  getMoyennesClasseMatiere,
  getElevesEvaluation,
  REQUETES_PREPARABLES,
} from '../../src/services/storage/queries';
import { creerBaseTest, seedClasse, seedEdt, seedAppel, seedPresences, seedEvaluation, seedNotes } from '../helpers/seedDb';
import { RealSqliteDb } from '../helpers/sqliteRealMock';

describe('Test de garde générique — toutes les requêtes se préparent contre le schéma réel', () => {
  let db: RealSqliteDb;

  beforeEach(async () => { db = await creerBaseTest(); });
  afterEach(() => db.close());

  it.each(REQUETES_PREPARABLES.map(r => [r.nom, r.sql] as const))(
    '%s : prepare() ne throw pas (colonnes/tables existantes)',
    (_nom, sql) => {
      expect(() => db.raw.prepare(sql)).not.toThrow();
    }
  );

  it('anti-régression : une requête sur une colonne inexistante THROW à la préparation', () => {
    // Preuve que le mécanisme de garde fonctionne : presences n'a pas de colonne
    // date_cours (bug historique corrigé). better-sqlite3 doit throw ici.
    expect(() => db.raw.prepare('SELECT presences.date_cours FROM presences')).toThrow();
    expect(() => db.raw.prepare('SELECT classe_id FROM eleves')).toThrow(); // eleves n'a pas classe_id
  });
});

describe('classes.tsx — compteurs par classe (régression bug classe_id)', () => {
  let db: RealSqliteDb;

  beforeEach(async () => {
    db = await creerBaseTest();
    await seedClasse(db, {
      classe: '6ème A',
      eleves: Array.from({ length: 7 }, (_, i) => ({ nom: `Nom${i}`, prenom: `Prenom${i}` })),
    });
    await seedClasse(db, {
      classe: '5ème B',
      eleves: Array.from({ length: 3 }, (_, i) => ({ nom: `Autre${i}`, prenom: `AutrePrenom${i}` })),
    });
    await seedEdt(db, [
      { jour_semaine: 1, heure_debut: '08:00', heure_fin: '09:00', matiere: 'Maths', classe_id: 'c1', classe: '6ème A' },
      { jour_semaine: 1, heure_debut: '09:00', heure_fin: '10:00', matiere: 'Francais', classe_id: 'c2', classe: '5ème B' },
    ]);
  });
  afterEach(() => db.close());

  it('renvoie 7 élèves pour 6ème A, jamais mélangé avec 5ème B', async () => {
    const row = await getNbElevesClasse(db, '6ème A');
    expect(row?.count).toBe(7);
  });

  it('renvoie 3 élèves pour 5ème B — non-fuite depuis 6ème A', async () => {
    const row = await getNbElevesClasse(db, '5ème B');
    expect(row?.count).toBe(3);
  });

  it('getClassesDepuisEdt renvoie les 2 classes distinctes', async () => {
    const rows = await getClassesDepuisEdt(db);
    expect(rows.map(r => r.classe).sort()).toEqual(['5ème B', '6ème A']);
  });

  it('getNbAbsencesJourClasse ne compte que les absences de la classe demandée', async () => {
    // Pas d'absences seedées aujourd'hui → 0 attendu pour les deux classes, sans erreur SQL
    const row6A = await getNbAbsencesJourClasse(db, '6ème A');
    const row5B = await getNbAbsencesJourClasse(db, '5ème B');
    expect(row6A?.count).toBe(0);
    expect(row5B?.count).toBe(0);
  });

  it('getMoyenneClasse ne throw pas et retourne null sans données', async () => {
    const row = await getMoyenneClasse(db, '6ème A');
    expect(row?.moy).toBeNull();
  });
});

describe('index.tsx — sparkline absences via jointure presences→appels (régression bug date_cours)', () => {
  let db: RealSqliteDb;

  beforeEach(async () => { db = await creerBaseTest(); });
  afterEach(() => db.close());

  it('compte les absences par date sans référencer presences.date_cours', async () => {
    const aujourdhui = new Date().toISOString().slice(0, 10);
    const appelId = await seedAppel(db, { date_cours: aujourdhui, matiere: 'Maths', classe: '6ème A' });
    await seedPresences(db, [
      { appel_id: appelId, inscription_id: 'i1', eleve_id: 'e1', eleve_nom: 'Diallo', eleve_prenom: 'M', statut: 'absent' },
      { appel_id: appelId, inscription_id: 'i2', eleve_id: 'e2', eleve_nom: 'Sow', eleve_prenom: 'A', statut: 'present' },
    ]);

    const rows = await getSparklineAbsences(db);

    expect(rows).toEqual([{ date_cours: aujourdhui, nb: 1 }]);
  });

  it('ne renvoie rien quand aucune présence absente sur les 7 derniers jours', async () => {
    const rows = await getSparklineAbsences(db);
    expect(rows).toEqual([]);
  });
});

describe('moyennes.tsx — moyennes filtrées par classe (jamais mélangées)', () => {
  let db: RealSqliteDb;

  beforeEach(async () => { db = await creerBaseTest(); });
  afterEach(() => db.close());

  it('ne mélange jamais les élèves de deux classes différentes', async () => {
    const { eleves: elevesA } = await seedClasse(db, {
      classe: '6ème A',
      eleves: [{ nom: 'Diallo', prenom: 'M' }, { nom: 'Ba', prenom: 'I' }],
    });
    const { eleves: elevesB } = await seedClasse(db, {
      classe: '5ème B',
      eleves: [{ nom: 'Sow', prenom: 'A' }],
    });

    const evalA = await seedEvaluation(db, { classe: '6ème A', matiere: 'Maths', notes_publiees: true });
    const evalB = await seedEvaluation(db, { classe: '5ème B', matiere: 'Maths', notes_publiees: true });

    await seedNotes(db, [
      { evaluation_id: evalA, eleve_id: elevesA[0].id, inscription_id: elevesA[0].inscription_id, valeur: 15 },
      { evaluation_id: evalA, eleve_id: elevesA[1].id, inscription_id: elevesA[1].inscription_id, valeur: 10 },
      { evaluation_id: evalB, eleve_id: elevesB[0].id, inscription_id: elevesB[0].inscription_id, valeur: 20 },
    ]);

    const moyennesA = await getMoyennesClasseMatiere(db, '6ème A', 'Maths');

    expect(moyennesA).toHaveLength(2);
    expect(moyennesA.map(m => m.eleve_id).sort()).toEqual([elevesA[0].id, elevesA[1].id].sort());
    expect(moyennesA.find(m => m.eleve_id === elevesB[0].id)).toBeUndefined();
  });

  it('ne renvoie rien pour une évaluation non publiée (notes_publiees=0)', async () => {
    const { eleves } = await seedClasse(db, { classe: '6ème A', eleves: [{ nom: 'Diallo', prenom: 'M' }] });
    const evalNonPub = await seedEvaluation(db, { classe: '6ème A', matiere: 'Maths', notes_publiees: false });
    await seedNotes(db, [{ evaluation_id: evalNonPub, eleve_id: eleves[0].id, inscription_id: eleves[0].inscription_id, valeur: 18 }]);

    const rows = await getMoyennesClasseMatiere(db, '6ème A', 'Maths');
    expect(rows).toEqual([]);
  });
});

describe('notes-saisie.tsx — chargement élèves d\'une évaluation (filtré par classe)', () => {
  let db: RealSqliteDb;

  beforeEach(async () => { db = await creerBaseTest(); });
  afterEach(() => db.close());

  it('ne renvoie que les élèves de la classe de l\'évaluation', async () => {
    const { eleves: elevesA } = await seedClasse(db, {
      classe: '6ème A',
      eleves: [{ nom: 'Diallo', prenom: 'M' }, { nom: 'Ba', prenom: 'I' }],
    });
    await seedClasse(db, { classe: '5ème B', eleves: [{ nom: 'Sow', prenom: 'A' }] });

    const evalId = await seedEvaluation(db, { classe: '6ème A', matiere: 'Maths' });

    const rows = await getElevesEvaluation(db, evalId, '6ème A');

    expect(rows).toHaveLength(2);
    expect(rows.map(r => r.id).sort()).toEqual(elevesA.map(e => e.id).sort());
  });

  it('remonte les notes existantes déjà saisies pour cette évaluation', async () => {
    const { eleves } = await seedClasse(db, { classe: '6ème A', eleves: [{ nom: 'Diallo', prenom: 'M' }] });
    const evalId = await seedEvaluation(db, { classe: '6ème A', matiere: 'Maths' });
    await seedNotes(db, [{ evaluation_id: evalId, eleve_id: eleves[0].id, inscription_id: eleves[0].inscription_id, valeur: 16.5 }]);

    const rows = await getElevesEvaluation(db, evalId, '6ème A');

    expect(rows[0].valeur).toBe(16.5);
  });
});
