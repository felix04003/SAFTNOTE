'use strict';

const { debutDeMois, cleMois, decision } = require('../../src/infrastructure/notifications/plafond-sms');

describe('debutDeMois / cleMois', () => {
  test('premier jour du mois à 00:00 UTC', () => {
    expect(debutDeMois(new Date('2026-10-31T23:59:59Z')).toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(debutDeMois(new Date('2026-01-01T00:00:00Z')).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
  test('clé « AAAA-MM »', () => {
    expect(cleMois(new Date('2026-10-07T12:00:00Z'))).toBe('2026-10');
  });
});

describe('decision', () => {
  const conso = (utilises, plafond) => ({ utilises, plafond });

  test('plafond 0 = illimité, quelle que soit la consommation', () => {
    expect(decision(conso(1_000_000, 0), 'quotidien')).toEqual({ autorise: true });
    expect(decision(conso(1_000_000, 0), 'urgence')).toEqual({ autorise: true });
  });

  test('sous le plafond : tout part', () => {
    for (const cat of ['urgence', 'quotidien', 'document', 'programme']) {
      expect(decision(conso(99, 100), cat).autorise).toBe(true);
    }
  });

  test('au plafond : les non urgentes sont bloquées, les urgences continuent', () => {
    for (const cat of ['quotidien', 'document', 'programme']) {
      expect(decision(conso(100, 100), cat)).toEqual({ autorise: false, raison: 'plafond_atteint' });
    }
    expect(decision(conso(100, 100), 'urgence').autorise).toBe(true);
    expect(decision(conso(149, 100), 'urgence').autorise).toBe(true);
  });

  test('à 150 % (butoir) : plus rien ne part, urgences comprises', () => {
    expect(decision(conso(150, 100), 'urgence')).toEqual({ autorise: false, raison: 'butoir_atteint' });
    expect(decision(conso(150, 100), 'quotidien')).toEqual({ autorise: false, raison: 'butoir_atteint' });
  });
});
