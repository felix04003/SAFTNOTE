import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { PageDiscipline, construireCorps } from '../pages/discipline';

const sanction = (id: string, extra: any = {}) => ({
  id, type: 'retenue', date_prononcee: '2026-10-12', motif: 'Bavardages répétés', nb_jours: null,
  eleve_id: 'u1', eleve_nom: 'N\'Diaye', eleve_prenom: 'Awa', classe: '6ème A', prononcee_par: 'Marie Faye', ...extra,
});

const PAGE = '<div id="tc"></div><span id="ph-sous-discipline"></span><select id="dsc-fil-classe"></select><table><tbody id="tb-discipline"></tbody></table><div id="pag-discipline"></div>' +
  '<div class="mo" id="m-sanction"></div><span id="dsc-modal-titre"></span><div id="dsc-err" class="login-err"></div><div id="dsc-bloc-creation"></div>' +
  '<select id="dsc-classe"></select><select id="dsc-eleve"></select><select id="dsc-type"><option value="">-</option><option value="retenue">r</option></select>' +
  '<input id="dsc-date"><input id="dsc-jours"><textarea id="dsc-motif"></textarea><button id="btn-sanction-save"></button>';

beforeEach(() => {
  document.body.innerHTML = PAGE;
  Object.assign(PageDiscipline, { data: [], classes: [], _page: 1, _classeId: '', _type: '', _editionId: '' });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('construireCorps', () => {
  it('création : élève, type et motif obligatoires', () => {
    expect(construireCorps({ motif: 'abc' }, true).erreur).toMatch(/motif/);
    expect(construireCorps({ motif: 'Insolence grave' }, true).erreur).toMatch(/élève/);
    expect(construireCorps({ motif: 'Insolence grave', inscription_id: 'i1' }, true).erreur).toMatch(/type/);
    expect(construireCorps({ motif: ' Insolence grave ', inscription_id: 'i1', type: 'retenue', date_prononcee: '2026-10-12', nb_jours: '2' }, true).corps)
      .toEqual({ motif: 'Insolence grave', inscription_id: 'i1', type: 'retenue', date_prononcee: '2026-10-12', nb_jours: 2 });
  });
  it('durée bornée à 1-30 jours et entière', () => {
    for (const j of ['0', '31', '1.5', 'x']) expect(construireCorps({ motif: 'Insolence grave', nb_jours: j }, false).erreur).toMatch(/jours/);
  });
  it('modification : seuls le motif et la durée partent', () => {
    expect(construireCorps({ motif: 'Nouveau motif', inscription_id: 'i1', type: 'retenue' }, false).corps).toEqual({ motif: 'Nouveau motif' });
  });
});

describe('PageDiscipline', () => {
  it('charge les sanctions avec les filtres et échappe les noms', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue({ data: [sanction('s1', { eleve_nom: '<b>X</b>' })], meta: { total: 1, page: 1, limite: 20, pages: 1 } } as any);
    PageDiscipline._classeId = 'c1'; PageDiscipline._type = 'retenue';
    await PageDiscipline.charger();
    expect(get).toHaveBeenCalledWith('/discipline/sanctions', { page: 1, limite: 20, classe_id: 'c1', type: 'retenue' });
    const html = document.getElementById('tb-discipline')!.innerHTML;
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('12/10/2026');
    expect(html).toContain('PageDiscipline.ouvrir(');
    expect(document.getElementById('ph-sous-discipline')!.textContent).toBe('1 sanction cette année');
  });

  it('affiche un message quand il n\'y a rien et l\'erreur du serveur sinon', async () => {
    vi.spyOn(Api, 'get').mockResolvedValueOnce({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 0 } } as any);
    await PageDiscipline.charger();
    expect(document.getElementById('tb-discipline')!.textContent).toContain('Aucune sanction');
    vi.spyOn(Api, 'get').mockRejectedValueOnce(new Error('Accès refusé'));
    await PageDiscipline.charger();
    expect(document.getElementById('tb-discipline')!.textContent).toContain('Accès refusé');
  });

  it('pagination : page suivante redemande la page 2', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue({ data: [sanction('s1')], meta: { total: 45, page: 1, limite: 20, pages: 3 } } as any);
    await PageDiscipline.charger();
    expect(document.getElementById('pag-discipline')!.innerHTML).toContain('PageDiscipline.page(1)');
    await PageDiscipline.page(1);
    expect(get).toHaveBeenLastCalledWith('/discipline/sanctions', { page: 2, limite: 20 });
  });

  it('élèves d\'une classe : liste par inscription', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [{ inscription_id: 'i1', nom: 'Diop', prenom: 'Awa' }] } as any);
    await PageDiscipline.chargerEleves('c1');
    const sel = document.getElementById('dsc-eleve') as HTMLSelectElement;
    expect(sel.disabled).toBe(false);
    expect(sel.innerHTML).toContain('value="i1"');
  });

  it('création : POST avec l\'inscription, le type et le motif', async () => {
    const post = vi.spyOn(Api, 'post').mockResolvedValue({} as any);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 0 } } as any);
    PageDiscipline.ouvrir();
    (document.getElementById('dsc-eleve') as HTMLSelectElement).innerHTML = '<option value="i1" selected>x</option>';
    (document.getElementById('dsc-type') as HTMLSelectElement).value = 'retenue';
    (document.getElementById('dsc-motif') as HTMLTextAreaElement).value = 'Bavardages répétés';
    await PageDiscipline.enregistrer();
    expect(post).toHaveBeenCalledWith('/discipline/sanctions', expect.objectContaining({ inscription_id: 'i1', type: 'retenue', motif: 'Bavardages répétés' }));
  });

  it('création invalide : message dans la fenêtre, aucun appel', async () => {
    const post = vi.spyOn(Api, 'post');
    PageDiscipline.ouvrir();
    await PageDiscipline.enregistrer();
    expect(post).not.toHaveBeenCalled();
    expect(document.getElementById('dsc-err')!.classList.contains('show')).toBe(true);
  });

  it('modification : PUT avec le seul motif, bloc de création masqué', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue({} as any);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [sanction('s1')], meta: { total: 1, page: 1, limite: 20, pages: 1 } } as any);
    await PageDiscipline.charger();
    PageDiscipline.ouvrir('s1');
    expect((document.getElementById('dsc-bloc-creation') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('dsc-motif') as HTMLTextAreaElement).value).toBe('Bavardages répétés');
    (document.getElementById('dsc-motif') as HTMLTextAreaElement).value = 'Motif corrigé';
    await PageDiscipline.enregistrer();
    expect(put).toHaveBeenCalledWith('/discipline/sanctions/s1', { motif: 'Motif corrigé' });
  });

  it('erreur du serveur à l\'enregistrement : affichée dans la fenêtre', async () => {
    vi.spyOn(Api, 'post').mockRejectedValue(new Error('Inscription introuvable'));
    PageDiscipline.ouvrir();
    (document.getElementById('dsc-eleve') as HTMLSelectElement).innerHTML = '<option value="i1" selected>x</option>';
    (document.getElementById('dsc-type') as HTMLSelectElement).value = 'retenue';
    (document.getElementById('dsc-motif') as HTMLTextAreaElement).value = 'Bavardages répétés';
    await PageDiscipline.enregistrer();
    expect(document.getElementById('dsc-err')!.textContent).toBe('Inscription introuvable');
  });
});
