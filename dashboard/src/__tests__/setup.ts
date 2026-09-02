import { vi, beforeEach } from 'vitest';

// Rendre window.location assignable (jsdom bloque l'assignation par défaut)
delete (window as any).location;
(window as any).location = { href: '', hash: '', pathname: '/', hostname: 'localhost' };

// Mock fetch global
vi.stubGlobal('fetch', vi.fn());

// Réinitialisation avant chaque test
beforeEach(() => {
  localStorage.clear();
  vi.mocked(fetch).mockClear();
  (window as any).location.href = '';
  (window as any).location.hash = '';
});
