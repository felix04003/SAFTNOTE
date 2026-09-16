'use strict';

/**
 * B4 — REDIS_URL doit être prioritaire sur REDIS_HOST/PORT/PASSWORD/DB
 * dans les deux fabriques de client Redis (`createClient`, utilisé pour le
 * cache, et `createBullMQConnection`, utilisé pour les files BullMQ).
 * Sans ce correctif, `app.js` initialisait Redis dès que REDIS_URL était
 * défini (ex: Render), mais les fabriques ignoraient cette variable et
 * retombaient silencieusement sur localhost:6379.
 */

jest.mock('ioredis', () => jest.fn().mockImplementation(() => ({
  on: jest.fn(),
  connect: jest.fn(),
})));

const Redis = require('ioredis');
// `createClient`/`createBullMQConnection` lisent process.env à l'appel —
// require() unique suffit, pas besoin de jest.resetModules() entre les tests
// (jest.config.js a clearMocks:true, donc Redis.mock.calls est déjà purgé
// avant chaque test).
const { createClient, createBullMQConnection } = require('../../src/infrastructure/cache/redis');

describe('infrastructure/cache/redis — fabriques de client', () => {
  const ENV_ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ENV_ORIGINAL };
  });

  describe('createClient', () => {
    it('avec REDIS_URL défini, construit Redis avec l\'URL en premier argument', () => {
      process.env.REDIS_URL = 'redis://:pwd@host:6380/1';

      createClient();

      expect(Redis).toHaveBeenCalledWith(
        'redis://:pwd@host:6380/1',
        expect.objectContaining({ enableReadyCheck: true, maxRetriesPerRequest: 3, lazyConnect: true })
      );
    });

    it('sans REDIS_URL, construit Redis avec les options host/port comme avant', () => {
      // REDIS_BASE_OPTIONS est calculé une seule fois au chargement du module
      // (comme en production, où dotenv est chargé avant tout require) — on
      // ne peut donc pas changer REDIS_HOST après coup dans ce test. On
      // vérifie plutôt que l'appel passe bien un objet d'options (pas l'URL)
      // avec les bonnes options spécifiques à createClient.
      delete process.env.REDIS_URL;

      createClient();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({ enableReadyCheck: true, maxRetriesPerRequest: 3, lazyConnect: true })
      );
      // Pas d'URL passée en premier argument
      expect(typeof Redis.mock.calls[0][0]).toBe('object');
    });
  });

  describe('createBullMQConnection', () => {
    it('avec REDIS_URL défini, construit Redis avec l\'URL et les options BullMQ', () => {
      process.env.REDIS_URL = 'redis://:pwd@host:6380/1';

      createBullMQConnection();

      expect(Redis).toHaveBeenCalledWith(
        'redis://:pwd@host:6380/1',
        expect.objectContaining({ maxRetriesPerRequest: null, enableReadyCheck: false })
      );
    });

    it('sans REDIS_URL, construit Redis avec les options host/port comme avant', () => {
      delete process.env.REDIS_URL;

      createBullMQConnection();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({ maxRetriesPerRequest: null, enableReadyCheck: false })
      );
      expect(typeof Redis.mock.calls[0][0]).toBe('object');
    });
  });
});
