'use strict';

const { emailPrisParPersonnel, ROLES_PERSONNEL } = require('../../src/utils/email-personnel');
const { mockQuery, createMockDB } = require('../helpers/mockKnex');

describe('emailPrisParPersonnel', () => {
  let db;
  beforeEach(() => { db = createMockDB(); });

  test('le personnel est défini sans les parents ni les élèves', () => {
    expect(ROLES_PERSONNEL).toEqual(expect.arrayContaining(['directeur', 'enseignant', 'censeur', 'admin', 'super_admin']));
    expect(ROLES_PERSONNEL).not.toContain('parent');
    expect(ROLES_PERSONNEL).not.toContain('eleve');
  });

  test('cherche sans tenir compte de la casse, dans tous les établissements, parmi les rôles du personnel actifs', async () => {
    const chaine = mockQuery({ id: 'u1', etablissement_id: 'e1' });
    db.mockReturnValueOnce(chaine);

    const trouve = await emailPrisParPersonnel(db, '  Directeur@Ecole.SN ');

    expect(trouve).toEqual({ id: 'u1', etablissement_id: 'e1' });
    expect(chaine.whereRaw).toHaveBeenCalledWith('LOWER(u.email) = ?', ['directeur@ecole.sn']);
    expect(chaine.whereIn).toHaveBeenCalledWith('r.code', ROLES_PERSONNEL);
    expect(chaine.where).toHaveBeenCalledWith('ur.actif', true);
    // aucun filtre d'établissement : la règle vaut entre écoles
    expect(chaine.where.mock.calls.flat().join(' ')).not.toMatch(/etablissement/);
  });

  test('ignore le compte indiqué (changement de son propre email)', async () => {
    const chaine = mockQuery(undefined);
    db.mockReturnValueOnce(chaine);

    await emailPrisParPersonnel(db, 'x@ecole.sn', { sauf: 'moi' });

    expect(chaine.where).toHaveBeenCalledWith('u.id', '!=', 'moi');
  });

  test('sans email : aucune requête', async () => {
    expect(await emailPrisParPersonnel(db, '')).toBeUndefined();
    expect(await emailPrisParPersonnel(db, undefined)).toBeUndefined();
    expect(db).not.toHaveBeenCalled();
  });
});
