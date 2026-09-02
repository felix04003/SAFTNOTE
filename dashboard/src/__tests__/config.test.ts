import { describe, it, expect } from 'vitest';
import { CONFIG } from '../config';

describe('CONFIG', () => {
  it('TOKEN_KEY est défini et non vide', () => {
    expect(CONFIG.TOKEN_KEY).toBeTruthy();
    expect(typeof CONFIG.TOKEN_KEY).toBe('string');
  });

  it('USER_KEY est défini et non vide', () => {
    expect(CONFIG.USER_KEY).toBeTruthy();
    expect(typeof CONFIG.USER_KEY).toBe('string');
  });

  it('API_BASE commence par https://', () => {
    expect(CONFIG.API_BASE).toMatch(/^https:\/\//);
  });

  it('SESSION_TIMEOUT est un nombre positif', () => {
    expect(CONFIG.SESSION_TIMEOUT).toBeGreaterThan(0);
  });

  it('TOKEN_KEY et USER_KEY sont différents', () => {
    expect(CONFIG.TOKEN_KEY).not.toBe(CONFIG.USER_KEY);
  });
});
