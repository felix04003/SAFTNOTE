// __tests__/helpers/sqliteRealMock.ts
// Adaptateur : surface async d'expo-sqlite (execAsync/runAsync/getFirstAsync/getAllAsync)
// implémentée par-dessus better-sqlite3 (synchrone, natif Node).
//
// ATTENTION : better-sqlite3 est une dépendance de TEST uniquement — ne jamais
// l'importer dans le code applicatif (src/), qui utilise expo-sqlite (moteur natif
// mobile différent). Ce fichier ne doit être importé QUE par des tests niveau A
// (SQL réel), jamais en même temps qu'un fichier qui `jest.mock('expo-sqlite')`.

import Database from 'better-sqlite3';
import type { DbLike } from '../../src/services/storage/queries';

export interface RealSqliteDb extends DbLike {
  raw: Database.Database;
  close(): void;
}

function normaliserParams(params?: any[]): any[] {
  if (!params) return [];
  // better-sqlite3 n'accepte pas `undefined` comme valeur de binding — SQLite
  // attend `null`. expo-sqlite tolère undefined ; on aligne le comportement.
  return params.map(p => (p === undefined ? null : p));
}

export function creerAdaptateurSqliteReel(filename: string = ':memory:'): RealSqliteDb {
  const raw = new Database(filename);

  return {
    raw,

    async execAsync(sql: string): Promise<void> {
      raw.exec(sql);
    },

    async runAsync(sql: string, params?: any[]): Promise<any> {
      const stmt = raw.prepare(sql);
      const info = stmt.run(...normaliserParams(params));
      return { changes: info.changes, lastInsertRowId: Number(info.lastInsertRowid) };
    },

    async getFirstAsync<T = any>(sql: string, params?: any[]): Promise<T | null> {
      const stmt = raw.prepare(sql);
      const row = stmt.get(...normaliserParams(params));
      return (row as T) ?? null;
    },

    async getAllAsync<T = any>(sql: string, params?: any[]): Promise<T[]> {
      const stmt = raw.prepare(sql);
      return stmt.all(...normaliserParams(params)) as T[];
    },

    close(): void {
      raw.close();
    },
  };
}
