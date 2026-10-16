import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { PageFicheEleve } from '../pages/fiche-eleve';

const MODALE = '<div id="tc"></div><div class="mo" id="m-parent"></div><span id="fpar-titre"></span>' +
  '<input id="fpar-prenom"><input id="fpar-nom"><input id="fpar-tel">' +
  '<select id="fpar-lien"><option value="mere">M</option><option value="pere">P</option><option value="tuteur">T</option></select>' +
  '<input id="fpar-principal" type="checkbox"><div id="fpar-droits"></div><p id="fpar-note-compte"></p>' +
  '<input id="fpar-notes" type="checkbox"><input id="fpar-absences" type="checkbox"><input id="fpar-bulletins" type="checkbox"><input id="fpar-discipline" type="checkbox">' +
  '<button id="fpar-enregistrer"></button>';

const maman = { id: 'p1', prenom: 'Mariama', nom: 'Sy', telephone: '+221770000701', lien: 'mere', est_contact_principal: true,
  peut_voir_notes: true, peut_voir_absences: true, peut_voir_bulletins: true, peut_voir_discipline: true };
const oncle = { id: 'p2', prenom: 'Omar', nom: 'Ba', telephone: '+221770000702', lien: 'pere', est_contact_principal: false,
  peut_voir_notes: true, peut_voir_absences: true, peut_voir_bulletins: false, peut_voir_discipline: true };

const champ = (id: string) => document.getElementById(id) as HTMLInputElement;

beforeEach(() => {
  document.body.innerHTML = MODALE;
  PageFicheEleve._id = 'eleve-1';
  PageFicheEleve._parents = [maman, oncle];
  PageFicheEleve._parentEdit = '';
  PageFicheEleve._parentInitial = null;
  vi.spyOn(PageFicheEleve, 'charger').mockResolvedValue(undefined as any);
});
afterEach(() => { vi.restoreAllMocks(); });

describe('affichage', () => {
  it('chaque parent a Modifier et Retirer, avec son identifiant seul dans l\'attribut', () => {
    const piege = { ...maman, id: 'p9', prenom: "N'Dour", nom: '<img src=x onerror=window.__pwn=1>' };
    const conteneur = document.createElement('div');
    conteneur.innerHTML = PageFicheEleve.rendreParents({ parents: [piege] });
    expect(conteneur.querySelector('img')).toBeNull();                                  // nom piégé neutralisé à l'affichage
    const boutons = Array.from(conteneur.querySelectorAll('button')).map((b) => b.getAttribute('onclick'));
    expect(boutons).toEqual([
      'PageFicheEleve.ajouterParent()', "PageFicheEleve.modifierParent('p9')", "PageFicheEleve.retirerParent('p9')",
    ]);
    expect((window as any).__pwn).toBeUndefined();
  });

  it('sans parent : message d\'alerte et bouton Ajouter', () => {
    const html = PageFicheEleve.rendreParents({ parents: [] });
    expect(html).toContain('Aucun parent enregistré');
    expect(html).toContain('ajouterParent');
  });
});

describe('ajouter', () => {
  it('le premier parent d\'un élève est proposé comme contact principal ; pas les suivants', () => {
    PageFicheEleve._parents = [];
    PageFicheEleve.ajouterParent();
    expect(champ('fpar-principal').checked).toBe(true);
    expect(document.getElementById('fpar-droits')!.style.display).toBe('none');
    PageFicheEleve._parents = [maman];
    PageFicheEleve.ajouterParent();
    expect(champ('fpar-principal').checked).toBe(false);
  });

  it('champs incomplets : rien n\'est envoyé', async () => {
    const post = vi.spyOn(Api, 'post');
    PageFicheEleve.ajouterParent();
    champ('fpar-prenom').value = 'A'; champ('fpar-nom').value = 'Diop'; champ('fpar-tel').value = '77 000 00 00';
    await PageFicheEleve.enregistrerParent();
    champ('fpar-prenom').value = 'Awa'; champ('fpar-tel').value = '123';
    await PageFicheEleve.enregistrerParent();
    expect(post).not.toHaveBeenCalled();
  });

  it('envoie le parent, recharge la fiche et dit quand le numéro était déjà connu', async () => {
    const post = vi.spyOn(Api, 'post').mockResolvedValue({ data: { compte_cree: false, compte_existant: { prenom: 'Mariama', nom: 'Sy' } } } as any);
    PageFicheEleve.ajouterParent();
    champ('fpar-prenom').value = 'Autre'; champ('fpar-nom').value = 'Nom'; champ('fpar-tel').value = '77 000 07 01'; champ('fpar-lien').value = 'mere';
    await PageFicheEleve.enregistrerParent();
    expect(post).toHaveBeenCalledWith('/eleves/eleve-1/parents', { prenom: 'Autre', nom: 'Nom', telephone: '77 000 07 01', lien: 'mere', est_contact_principal: false });
    expect(PageFicheEleve.charger).toHaveBeenCalled();
    expect(document.body.textContent).toContain('déjà celui de Mariama Sy');
  });

  it('erreur du serveur : message affiché, formulaire conservé, bouton réactivé', async () => {
    vi.spyOn(Api, 'post').mockRejectedValue(new Error('Mariama Sy est déjà rattaché(e) à cet élève'));
    PageFicheEleve.ajouterParent();
    champ('fpar-prenom').value = 'Mariama'; champ('fpar-nom').value = 'Sy'; champ('fpar-tel').value = '77 000 07 01';
    await PageFicheEleve.enregistrerParent();
    expect(document.body.textContent).toContain('déjà rattaché');
    expect(champ('fpar-prenom').value).toBe('Mariama');
    expect((champ('fpar-enregistrer') as unknown as HTMLButtonElement).disabled).toBe(false);
    expect(PageFicheEleve.charger).not.toHaveBeenCalled();
  });
});

describe('modifier', () => {
  it('préremplit le formulaire (droits compris) et montre la section des droits', () => {
    PageFicheEleve.modifierParent('p2');
    expect(champ('fpar-prenom').value).toBe('Omar');
    expect(champ('fpar-tel').value).toBe('+221770000702');
    expect(champ('fpar-lien').value).toBe('pere');
    expect(champ('fpar-bulletins').checked).toBe(false);
    expect(champ('fpar-notes').checked).toBe(true);
    expect(document.getElementById('fpar-droits')!.style.display).toBe('');
  });

  it('n\'envoie QUE ce qui a changé', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue({ data: {} } as any);
    PageFicheEleve.modifierParent('p2');
    champ('fpar-tel').value = '78 111 22 33';
    champ('fpar-principal').checked = true;
    champ('fpar-bulletins').checked = true;
    await PageFicheEleve.enregistrerParent();
    expect(put).toHaveBeenCalledWith('/eleves/eleve-1/parents/p2', { telephone: '78 111 22 33', est_contact_principal: true, peut_voir_bulletins: true });
    expect(PageFicheEleve.charger).toHaveBeenCalled();
  });

  it('rien n\'a changé : aucun envoi, la fenêtre se ferme', async () => {
    const put = vi.spyOn(Api, 'put');
    PageFicheEleve.modifierParent('p1');
    await PageFicheEleve.enregistrerParent();
    expect(put).not.toHaveBeenCalled();
  });

  it('un compte du personnel : le refus du serveur est affiché tel quel', async () => {
    vi.spyOn(Api, 'put').mockRejectedValue(new Error('Ce compte est aussi celui d\'un membre du personnel'));
    PageFicheEleve.modifierParent('p1');
    champ('fpar-nom').value = 'Autre';
    await PageFicheEleve.enregistrerParent();
    expect(document.body.textContent).toContain('membre du personnel');
  });
});

describe('retirer', () => {
  it('confirmation refusée : aucun envoi', async () => {
    const del = vi.spyOn(Api, 'del');
    window.confirm = vi.fn().mockReturnValue(false);
    await PageFicheEleve.retirerParent('p2');
    expect(del).not.toHaveBeenCalled();
  });

  it('confirmation acceptée : DELETE puis rechargement ; le message de confirmation nomme la personne', async () => {
    const del = vi.spyOn(Api, 'del').mockResolvedValue({ data: {} } as any);
    window.confirm = vi.fn().mockReturnValue(true);
    await PageFicheEleve.retirerParent('p2');
    expect(String((window.confirm as any).mock.calls[0][0])).toContain('Omar Ba');
    expect(del).toHaveBeenCalledWith('/eleves/eleve-1/parents/p2');
    expect(PageFicheEleve.charger).toHaveBeenCalled();
  });
});
