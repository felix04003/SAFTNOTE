'use strict';

const bcrypt = require('bcryptjs');
const { auditerMotsDePasse, candidatsPour } = require('../../src/utils/auditer-mots-de-passe');

const log = jest.fn();

function pool(rows) {
  const query = jest.fn().mockImplementation(async (sql) => (/^\s*SELECT/i.test(sql) ? { rows } : { rows: [] }));
  return { query };
}

const compte = (id, mdp, extra = {}) => ({
  id, nom: 'Cisse', prenom: 'Mame', telephone: '+221771110001', telephone_2: null,
  code_officiel: 'LYC-DAKAR-1234', pays: 'SN', ...extra,
  mot_de_passe_hash: bcrypt.hashSync(mdp, 4),
});

describe('candidatsPour', () => {
  test('inclut les formes du téléphone, les mots de passe courants, le code établissement et le nom', () => {
    const c = candidatsPour(compte('u', 'x'));
    const valeurs = c.map(x => x.valeur);
    expect(valeurs).toEqual(expect.arrayContaining(['+221771110001', '221771110001', '771110001', '123456', 'LYC-DAKAR-1234']));
    expect(c.find(x => x.valeur === '771110001').cause).toBe('telephone');
  });

  test('ignore ce qui est plus court que le minimum de connexion (6)', () => {
    expect(candidatsPour({ nom: 'Ba', prenom: 'Al', telephone: null }).map(x => x.valeur)).not.toContain('Ba');
  });
});

describe('auditerMotsDePasse', () => {
  beforeEach(() => jest.clearAllMocks());

  const base = () => [
    compte('tel', '+221771110001'),
    compte('courant', '123456'),
    compte('solide', 'Tr0ubadour-Sun9'),
    compte('code', 'LYC-DAKAR-1234'),
  ];

  test('simulation : détecte les comptes prévisibles, n\'écrit rien', async () => {
    const p = pool(base());
    const res = await auditerMotsDePasse(p, { log });

    expect(res.examines).toBe(4);
    expect(res.faibles).toEqual(expect.arrayContaining([
      { id: 'tel', cause: 'telephone' }, { id: 'courant', cause: 'courant' }, { id: 'code', cause: 'code_etablissement' },
    ]));
    expect(res.faibles.map(f => f.id)).not.toContain('solide');
    expect(res.parCause).toEqual({ telephone: 1, courant: 1, code_etablissement: 1 });
    expect(p.query).toHaveBeenCalledTimes(1); // SELECT seul
  });

  test('--appliquer : UPDATE paramétré, uniquement pour les comptes faibles', async () => {
    const p = pool(base());
    await auditerMotsDePasse(p, { appliquer: true, log });

    const updates = p.query.mock.calls.filter(([sql]) => /UPDATE utilisateurs SET mdp_a_changer = TRUE/.test(sql));
    expect(updates.map(([, params]) => params[0]).sort()).toEqual(['code', 'courant', 'tel']);
  });

  test('ne journalise jamais le mot de passe trouvé', async () => {
    await auditerMotsDePasse(pool(base()), { log });
    const sortie = log.mock.calls.map(c => c.join(' ')).join('\n');
    for (const secret of ['+221771110001', '123456', 'LYC-DAKAR-1234']) expect(sortie).not.toContain(secret);
  });

  test('requête : exclut les comptes déjà marqués, inactifs ou sans mot de passe', async () => {
    const p = pool([]);
    await auditerMotsDePasse(p, { log });
    const sql = p.query.mock.calls[0][0];
    expect(sql).toMatch(/mot_de_passe_hash IS NOT NULL/);
    expect(sql).toMatch(/mdp_a_changer = FALSE/);
    expect(sql).toMatch(/actif = TRUE/);
  });

  test('comparaison injectée : une seconde passe (comptes déjà marqués exclus par la requête) ne trouve rien', async () => {
    const res = await auditerMotsDePasse(pool([]), { log });
    expect(res).toMatchObject({ examines: 0, faibles: [] });
  });
});
