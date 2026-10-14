import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ParApp } from '../par-app';
import { Notifs } from '../notifs';

describe('parent : changement d\'école sans rechargement', () => {
  beforeEach(() => {
    document.body.innerHTML =
      '<div class="page active" id="page-par-dashboard"><span id="kpi">gabarit</span></div>' +
      '<div class="page" id="page-par-notes"><table><tbody id="tb"></tbody></table></div>' +
      '<div id="par-enfant-wrap"><select id="par-enfant-sel"></select></div>';
    ParApp._modeles.clear();
  });

  it('les gabarits mémorisés remettent les pages et le bloc enfant à leur état d\'origine', () => {
    ParApp._memoriserModeles();

    // Données de l'ancienne école affichées
    document.getElementById('kpi')!.textContent = 'Moyenne de Moussa';
    document.getElementById('tb')!.innerHTML = '<tr><td>Maths 14</td></tr>';
    document.getElementById('par-enfant-wrap')!.innerHTML = '<div>Moussa Ndiaye</div>';

    ParApp._restaurerModeles();

    expect(document.getElementById('kpi')!.textContent).toBe('gabarit');
    expect(document.getElementById('tb')!.children).toHaveLength(0);
    expect(document.getElementById('par-enfant-sel')).not.toBeNull();   // le <select> détruit pour un enfant unique revient
    expect(document.body.textContent).not.toContain('Moussa');
  });

  it('_construireSelecteurEcole : reconstruit sans empiler d\'écouteurs (un seul onchange)', () => {
    document.body.insertAdjacentHTML('beforeend', '<select id="par-ecole-sel"></select>');
    const sel = document.getElementById('par-ecole-sel') as HTMLSelectElement;
    const ecoles = [{ code: 'A', nom: 'A', courant: true }, { code: 'B', nom: 'B', courant: false }];
    const basculer = vi.spyOn(ParApp, '_basculerEcole').mockResolvedValue(undefined);

    ParApp._construireSelecteurEcole(ecoles, sel);
    ParApp._construireSelecteurEcole(ecoles, sel);      // reconstruit après une bascule
    sel.value = 'B';
    sel.dispatchEvent(new Event('change'));

    expect(basculer).toHaveBeenCalledTimes(1);
    expect(sel.disabled).toBe(false);
    basculer.mockRestore();
  });

  it('Notifs.reinitialiser : vide les données et le badge de l\'ancienne école', () => {
    document.body.insertAdjacentHTML('beforeend', '<span id="notif-badge" class="show">7</span>');
    Notifs._data = { total: 7 };
    vi.mocked(fetch).mockResolvedValue({ status: 200, ok: true, json: async () => ({ data: { total: 0 } }) } as Response);

    Notifs.reinitialiser();

    expect(Notifs._data).toBeNull();
    expect(document.getElementById('notif-badge')!.textContent).toBe('0');
    expect(document.getElementById('notif-badge')!.classList.contains('show')).toBe(false);
  });
});
