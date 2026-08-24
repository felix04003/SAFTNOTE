/**
 * Tests SQL réels — file operations_pending (sync montante).
 *
 * Niveau A : vrai SQLite en mémoire. C'est le point de perte de données le plus
 * critique (enseignant hors ligne) — on teste insertion, filtrage, idempotence,
 * ordre FIFO contre le vrai schéma.
 */

import { insererOperationPendante, getOperationsPendantesDb, marquerOperationSyncedDb } from '../../src/services/storage/queries';
import { creerBaseTest } from '../helpers/seedDb';
import { RealSqliteDb } from '../helpers/sqliteRealMock';

describe('operations_pending', () => {
  let db: RealSqliteDb;

  beforeEach(async () => { db = await creerBaseTest(); });
  afterEach(() => db.close());

  it('insère une opération avec statut initial "en_attente"', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', JSON.stringify({ note: 15 }));

    const row = await db.getFirstAsync<any>('SELECT * FROM operations_pending WHERE id=?', ['op1']);
    expect(row).not.toBeNull();
    expect(row.statut).toBe('en_attente');
    expect(row.type).toBe('SAISIR_NOTE');
    expect(row.tentatives).toBe(0);
  });

  it('getOperationsPendantesDb ne renvoie que les non-synchronisées', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', '{}');
    await insererOperationPendante(db, 'op2', 'SAISIR_NOTE', '{}');
    await marquerOperationSyncedDb(db, 'op2');

    const ops = await getOperationsPendantesDb(db);

    expect(ops.map(o => o.id)).toEqual(['op1']);
  });

  it('getOperationsPendantesDb inclut les opérations en erreur avec moins de 5 tentatives', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', '{}');
    await db.runAsync(`UPDATE operations_pending SET statut='erreur', tentatives=2 WHERE id=?`, ['op1']);

    const ops = await getOperationsPendantesDb(db);
    expect(ops.map(o => o.id)).toEqual(['op1']);
  });

  it('getOperationsPendantesDb exclut les opérations en erreur avec 5+ tentatives (dead-letter)', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', '{}');
    await db.runAsync(`UPDATE operations_pending SET statut='erreur', tentatives=5 WHERE id=?`, ['op1']);

    const ops = await getOperationsPendantesDb(db);
    expect(ops).toEqual([]);
  });

  it('marquerOperationSyncedDb bascule le statut — l\'op ne ressort plus', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', '{}');

    await marquerOperationSyncedDb(db, 'op1');

    const row = await db.getFirstAsync<any>('SELECT statut FROM operations_pending WHERE id=?', ['op1']);
    expect(row.statut).toBe('envoyé');
    const ops = await getOperationsPendantesDb(db);
    expect(ops).toEqual([]);
  });

  it('idempotence : rejouer marquerOperationSyncedDb sur une op déjà synced ne duplique rien', async () => {
    await insererOperationPendante(db, 'op1', 'SAISIR_NOTE', '{}');
    await marquerOperationSyncedDb(db, 'op1');
    await marquerOperationSyncedDb(db, 'op1'); // rejoué

    const rows = await db.getAllAsync<any>('SELECT * FROM operations_pending WHERE id=?', ['op1']);
    expect(rows).toHaveLength(1);
    expect(rows[0].statut).toBe('envoyé');
  });

  it('ordre FIFO : les ops pendantes sont renvoyées dans l\'ordre d\'insertion', async () => {
    // created_at_local a une résolution à la seconde (datetime('now')) — on force
    // des valeurs explicites pour garantir un ordre déterministe dans le test.
    await db.runAsync(
      `INSERT INTO operations_pending (id, type, payload, created_at_local) VALUES (?, ?, ?, ?)`,
      ['op-3', 'X', '{}', '2026-01-01T00:00:03Z']
    );
    await db.runAsync(
      `INSERT INTO operations_pending (id, type, payload, created_at_local) VALUES (?, ?, ?, ?)`,
      ['op-1', 'X', '{}', '2026-01-01T00:00:01Z']
    );
    await db.runAsync(
      `INSERT INTO operations_pending (id, type, payload, created_at_local) VALUES (?, ?, ?, ?)`,
      ['op-2', 'X', '{}', '2026-01-01T00:00:02Z']
    );

    const ops = await getOperationsPendantesDb(db);

    expect(ops.map(o => o.id)).toEqual(['op-1', 'op-2', 'op-3']);
  });
});
