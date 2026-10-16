import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { exporterCsv } from '../ui';
import { PageEleves } from '../pages/eleves';
import { PageBulletins } from '../pages/bulletins';
import { PageAbsences } from '../pages/absences';
import { PageDiscipline } from '../pages/discipline';

const fichier = (nom = 'eleves-2026-2027.csv') => ({
  status: 200, ok: true,
  headers: { get: (k: string) => (k === 'Content-Disposition' ? `attachment; filename="${nom}"` : null) },
  blob: async () => new Blob(['﻿Nom\r\n'], { type: 'text/csv' }),
} as unknown as Response);

beforeEach(() => {
  vi.mocked(fetch).mockReset();
  sessionStorage.clear();
  document.body.innerHTML = '<div id="tc"></div>';
  (URL as any).createObjectURL = vi.fn(() => 'blob:x');
  (URL as any).revokeObjectURL = vi.fn();
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Api.telecharger', () => {
  it('renvoie le nom du fichier annoncé par le serveur et son contenu, avec le jeton et les paramètres', async () => {
    sessionStorage.setItem('em_token', 'jeton');
    vi.mocked(fetch).mockResolvedValueOnce(fichier('moyennes-Trimestre-1-2026-2027.csv'));
    const { nom, contenu } = await Api.telecharger('/exports/moyennes.csv', { periode_id: 'p1', classe_id: undefined });
    expect(nom).toBe('moyennes-Trimestre-1-2026-2027.csv');
    expect(contenu.size).toBeGreaterThan(0);
    const [url, opts] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/exports/moyennes.csv?periode_id=p1');
    expect(url).not.toContain('classe_id');
    expect((opts.headers as any).Authorization).toBe('Bearer jeton');
  });

  it('une erreur du serveur reste une erreur JSON lisible (403 : permission)', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 403, ok: false, headers: { get: () => null }, json: async () => ({ erreur: 'Permission requise : rapports.exporter', code: 'PERMISSION' }) } as unknown as Response);
    await expect(Api.telecharger('/exports/eleves.csv')).rejects.toThrow('Permission requise : rapports.exporter');
  });

  it('session expirée : le jeton est rafraîchi puis le fichier est bien repris en mode fichier (pas de JSON)', async () => {
    sessionStorage.setItem('em_token', 'vieux');
    sessionStorage.setItem('em_refresh_token', 'refresh');
    vi.mocked(fetch)
      .mockResolvedValueOnce({ status: 401, ok: false, headers: { get: () => null }, json: async () => ({}) } as unknown as Response)
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ data: { token: 'neuf', refresh_token: 'refresh2' } }) } as unknown as Response)
      .mockResolvedValueOnce(fichier());
    const { nom } = await Api.telecharger('/exports/eleves.csv');
    expect(nom).toBe('eleves-2026-2027.csv');
  });
});

describe('exporterCsv', () => {
  it('déclenche l\'enregistrement du fichier et prévient', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(fichier());
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await exporterCsv('/exports/eleves.csv');
    expect(clic).toHaveBeenCalledTimes(1);
    expect((URL as any).createObjectURL).toHaveBeenCalled();
    expect(document.getElementById('toast-container')!.textContent).toContain('eleves-2026-2027.csv');
    expect(document.querySelector('a[download]')).toBeNull();                        // le lien temporaire est retiré
  });

  it('refus du serveur : message affiché, aucun téléchargement', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ status: 403, ok: false, headers: { get: () => null }, json: async () => ({ erreur: 'Permission requise : rapports.exporter' }) } as unknown as Response);
    const clic = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await exporterCsv('/exports/eleves.csv');
    expect(clic).not.toHaveBeenCalled();
    expect(document.getElementById('toast-container')!.textContent).toContain('Permission requise');
  });
});

describe('boutons « Exporter » des pages', () => {
  const telecharger = () => vi.spyOn(Api, 'telecharger').mockResolvedValue({ nom: 'x.csv', contenu: new Blob(['a']) });
  beforeEach(() => { vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}); });

  it('élèves : inscrits par défaut, filtres de classe et de statut respectés', async () => {
    const t = telecharger();
    PageEleves.statut = ''; PageEleves.classeId = '';
    await PageEleves.exporter();
    expect(t).toHaveBeenLastCalledWith('/exports/eleves.csv', { statut: 'actif', classe_id: undefined });
    PageEleves.statut = 'retires'; PageEleves.classeId = 'c1';
    await PageEleves.exporter();
    expect(t).toHaveBeenLastCalledWith('/exports/eleves.csv', { statut: 'retires', classe_id: 'c1' });
  });

  it('bulletins : la période affichée ; sans période, un avertissement', async () => {
    const t = telecharger();
    PageBulletins._periodeId = '';
    await PageBulletins.exporter();
    expect(t).not.toHaveBeenCalled();
    PageBulletins._periodeId = 'p1';
    await PageBulletins.exporter();
    expect(t).toHaveBeenCalledWith('/exports/moyennes.csv', { periode_id: 'p1' });
  });

  it('absences et discipline', async () => {
    const t = telecharger();
    await PageAbsences.exporter();
    expect(t).toHaveBeenLastCalledWith('/exports/absences.csv', undefined);
    PageDiscipline._classeId = 'c2'; PageDiscipline._type = 'retenue';
    await PageDiscipline.exporter();
    expect(t).toHaveBeenLastCalledWith('/exports/sanctions.csv', { classe_id: 'c2', type: 'retenue' });
  });
});
