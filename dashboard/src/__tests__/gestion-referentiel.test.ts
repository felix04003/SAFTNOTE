import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { jsArg } from '../ui';
import { PageSecurite } from '../pages/securite';
import { PageEnseignants } from '../pages/enseignants';
import { PageEleves } from '../pages/eleves';
import { PageClasses } from '../pages/classes';
import { PageParametres } from '../pages/parametres';

const REPONSE = { success: true, data: {} } as any;
const champ = (id: string, v: string) => ((document.getElementById(id) as HTMLInputElement).value = v);
const valeur = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

beforeEach(() => {
  document.body.innerHTML = '<div id="tc"></div>';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('Élèves — actions selon le statut', () => {
  it('un élève inscrit : Fiche, Modifier, Retirer ; un élève retiré : Fiche et Réintégrer seulement', () => {
    const inscrit = PageEleves.actions({ id: 'u1', prenom: 'Awa', nom: 'Diop', statut: 'actif' });
    expect(inscrit).toContain('Modifier');
    expect(inscrit).toContain('Retirer');
    expect(inscrit).not.toContain('Réintégrer');
    const retire = PageEleves.actions({ id: 'u1', prenom: 'Awa', nom: 'Diop', statut: 'transfere' });
    expect(retire).toContain('Réintégrer');
    expect(retire).not.toContain('Modifier');
    expect(retire).not.toContain('Retirer');
  });

  it('une apostrophe dans un nom ne casse pas le bouton et ne permet pas d\'injecter du code', () => {
    const conteneur = document.createElement('div');
    for (const nom of ["Mame N'Diaye", `x");window.__pwn=1;//`, `x');window.__pwn=1;//`]) {
      conteneur.innerHTML = PageEleves.actions({ id: 'u1', prenom: nom, nom: '', statut: 'actif' });
      const onclick = (conteneur.querySelectorAll('button')[2] as HTMLElement).getAttribute('onclick') || '';
      // Ce que le navigateur exécute réellement : l'attribut DÉCODÉ. Il doit être UNE seule instruction d'appel
      const appels: any[] = [];
      new Function('PageEleves', onclick)({ retirer: (...a: any[]) => appels.push(a) });
      expect(appels).toEqual([['u1', nom.trim()]]);
    }
    expect((window as any).__pwn).toBeUndefined();
  });

  it('badge de statut', () => {
    expect(PageEleves.badgeStatut('actif')).toContain('Inscrit');
    expect(PageEleves.badgeStatut('exclu')).toContain('Exclu');
  });

  it('le filtre « Retirés » demande statut=retires à l\'API', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 1 } } as any);
    document.body.innerHTML += '<table><tbody id="tb-eleves"></tbody></table><div id="pag-eleves"></div>';
    PageEleves.statut = '';
    await PageEleves.filtrerStatut('retires');
    expect(get).toHaveBeenCalledWith('/eleves', expect.objectContaining({ statut: 'retires' }));
    PageEleves.statut = '';
  });
});

describe('Élèves — modifier', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div>' +
      ['prenom', 'nom', 'ddn', 'tel', 'matricule'].map((n) => `<input id="emod-${n}">`).join('') +
      '<select id="emod-genre"><option value=""></option><option value="F">F</option></select>' +
      '<select id="emod-classe"></select><button id="btn-eleve-modif"></button>';
  });

  async function ouvrir() {
    vi.spyOn(Api, 'get').mockImplementation(async (chemin: string) => {
      if (chemin === '/classes') return { data: [{ id: 'c1', nom_classe: '6ème A' }, { id: 'c2', nom_classe: '6ème B' }] } as any;
      return { data: { prenom: 'Awa', nom: 'Diop', date_naissance: '2013-03-14T00:00:00.000Z', genre: 'F', telephone: '+221770000001', matricule: 'MAT1', classe_id: 'c1' } } as any;
    });
    await PageEleves.modifier('u1');
  }

  it('préremplit la fiche (date tronquée à AAAA-MM-JJ, classe actuelle sélectionnée)', async () => {
    await ouvrir();
    expect(valeur('emod-prenom')).toBe('Awa');
    expect(valeur('emod-ddn')).toBe('2013-03-14');
    expect(valeur('emod-classe')).toBe('c1');
  });

  it('classe inchangée : classe_id n\'est PAS envoyé ; classe changée : il l\'est', async () => {
    await ouvrir();
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 1 } } as any);
    await PageEleves.enregistrerModif();
    expect(put.mock.calls[0][0]).toBe('/eleves/u1');
    expect(put.mock.calls[0][1]).not.toHaveProperty('classe_id');
    expect(put.mock.calls[0][1]).toMatchObject({ prenom: 'Awa', nom: 'Diop', matricule: 'MAT1', telephone: '+221770000001' });

    champ('emod-classe', 'c2');
    champ('emod-tel', '');                     // téléphone vidé = effacé côté serveur
    await PageEleves.enregistrerModif();
    expect(put.mock.calls[1][1]).toMatchObject({ classe_id: 'c2', telephone: null });
  });

  it('champs obligatoires manquants : aucun envoi', async () => {
    await ouvrir();
    const put = vi.spyOn(Api, 'put');
    champ('emod-nom', '');
    await PageEleves.enregistrerModif();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('Élèves — retirer et réintégrer', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><span id="ret-titre"></span><select id="ret-statut"><option value="transfere">T</option><option value="exclu">E</option></select><input id="ret-motif"><button id="btn-eleve-retrait"></button>';
  });

  it('retrait : motif obligatoire, puis PUT /statut', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 1 } } as any);
    PageEleves.retirer('u9', 'Awa Diop');
    await PageEleves.confirmerRetrait();                         // motif vide
    expect(put).not.toHaveBeenCalled();
    champ('ret-motif', 'Déménagement');
    champ('ret-statut', 'exclu');
    await PageEleves.confirmerRetrait();
    expect(put).toHaveBeenCalledWith('/eleves/u9/statut', { statut: 'exclu', motif: 'Déménagement' });
  });

  it('réintégration : confirmation demandée ; refus = aucun envoi', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0, page: 1, limite: 20, pages: 1 } } as any);
    window.confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    await PageEleves.reintegrer('u9', 'Awa Diop');
    expect(put).not.toHaveBeenCalled();
    await PageEleves.reintegrer('u9', 'Awa Diop');
    expect(put).toHaveBeenCalledWith('/eleves/u9/statut', { statut: 'actif' });
  });
});

describe('Classes — modifier et archiver', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><span id="m-classe-titre"></span><select id="m-classe-niveau"></select><input id="m-classe-nom"><input id="m-classe-salle"><input id="m-classe-effectif"><button id="btn-creer-classe"></button><div id="cls-grid"></div>';
    PageClasses.data = [{ id: 'k1', nom: 'A', nom_classe: '6ème A', salle_principale: 'Salle 1', effectif_max: 40 }];
    PageClasses._niveaux = [{ id: 'n1', nom: '6ème' }];
  });

  it('modifier préremplit et verrouille le niveau ; l\'enregistrement fait un PUT (pas un POST)', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    const post = vi.spyOn(Api, 'post');
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    await PageClasses.modifier('k1');
    expect(valeur('m-classe-nom')).toBe('A');
    expect((document.getElementById('m-classe-niveau') as HTMLSelectElement).disabled).toBe(true);
    expect(document.getElementById('btn-creer-classe')!.textContent).toBe('Enregistrer');
    champ('m-classe-salle', '');
    await PageClasses.creer();
    expect(put).toHaveBeenCalledWith('/classes/k1', { nom: 'A', salle_principale: null, effectif_max: 40 });
    expect(post).not.toHaveBeenCalled();
  });

  it('« Nouvelle classe » après une modification repart d\'un formulaire vide en mode création', async () => {
    await PageClasses.modifier('k1');
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    PageClasses.ouvrirModal();
    expect(valeur('m-classe-nom')).toBe('');
    expect((document.getElementById('m-classe-niveau') as HTMLSelectElement).disabled).toBe(false);
    expect(PageClasses._editId).toBe('');
  });

  it('archiver : confirmation puis DELETE ; l\'erreur du serveur (classe non vide) est affichée', async () => {
    const del = vi.spyOn(Api, 'del').mockRejectedValue(new Error('Impossible : 3 élève(s) sont inscrits'));
    window.confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    await PageClasses.archiver('k1');
    expect(del).not.toHaveBeenCalled();
    await PageClasses.archiver('k1');
    expect(del).toHaveBeenCalledWith('/classes/k1');
    expect(document.body.textContent).toContain('3 élève(s) sont inscrits');
  });
});

describe('Matières — modifier, archiver, réactiver', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><span id="m-mat-titre"></span><input id="m-mat-nom"><input id="m-mat-court"><input id="m-mat-code"><select id="m-mat-moyenne"><option value="true">Oui</option><option value="false">Non</option></select><select id="m-mat-discipline"><option value=""></option><option value="d1">D</option></select><button id="btn-creer-matiere"></button><div id="param-matieres-liste"></div>';
    PageParametres.matieresCache = [{ id: 'm1', nom: 'Maths', nom_court: 'Mat', code: 'MATH', compte_dans_moyenne: false, discipline_id: 'd1', actif: true }];
  });

  it('la liste propose Archiver pour une matière active, Réactiver pour une matière inactive', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [
      { id: 'm1', nom: 'Maths', code: 'MATH', actif: true }, { id: 'm2', nom: 'Latin', code: 'LAT', actif: false },
    ] } as any);
    await PageParametres.chargerMatieres();
    const lignes = document.querySelectorAll('#param-matieres-liste > div');
    expect(lignes[0].textContent).toContain('Archiver');
    expect(lignes[1].textContent).toContain('Réactiver');
    expect(lignes[1].textContent).not.toContain('Archiver');
  });

  it('modifier préremplit ; l\'enregistrement fait un PUT avec les champs effaçables à null', async () => {
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    const post = vi.spyOn(Api, 'post');
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    PageParametres.modifierMatiere('m1');
    expect(valeur('m-mat-code')).toBe('MATH');
    expect(valeur('m-mat-moyenne')).toBe('false');
    champ('m-mat-court', '');
    champ('m-mat-discipline', '');
    await PageParametres.creerMatiere();
    expect(put).toHaveBeenCalledWith('/configs/matieres/m1', { nom: 'Maths', nom_court: null, code: 'MATH', compte_dans_moyenne: false, discipline_id: null });
    expect(post).not.toHaveBeenCalled();
  });

  it('archiver : confirmation puis DELETE ; réactiver : PUT actif', async () => {
    const del = vi.spyOn(Api, 'del').mockResolvedValue(REPONSE);
    const put = vi.spyOn(Api, 'put').mockResolvedValue(REPONSE);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    window.confirm = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    await PageParametres.archiverMatiere('m1');
    expect(del).not.toHaveBeenCalled();
    await PageParametres.archiverMatiere('m1');
    expect(del).toHaveBeenCalledWith('/configs/matieres/m1');
    await PageParametres.reactiverMatiere('m1');
    expect(put).toHaveBeenCalledWith('/configs/matieres/m1', { actif: true });
  });
});


describe('jsArg — argument texte sûr dans un attribut onclick', () => {
  it('produit un littéral JavaScript, échappé pour HTML', () => {
    expect(jsArg('Awa')).toBe('&quot;Awa&quot;');
    expect(jsArg(null)).toBe('&quot;&quot;');
    const decode = (h: string) => new DOMParser().parseFromString(h, 'text/html').documentElement.textContent || '';
    for (const texte of [`N'Diaye`, `a"b`, 'a\\b', '<img src=x>', 'ligne1\nligne2', `');alert(1);//`]) {
      expect(new Function('return ' + decode(jsArg(texte)))()).toBe(texte);       // revient exactement au texte d'origine
    }
  });

  it('Sécurité (Bloquer / Débloquer) : le nom piégé arrive intact, sans exécuter de code', async () => {
    document.body.innerHTML = '<table><tbody id="tb-sessions"></tbody><tbody id="tb-bloques"></tbody><tbody id="tb-ens"></tbody></table><div id="tc"></div>';
    const piege = `x');window.__pwn=1;//`;
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [{ id: 's1', utilisateur_id: 'u2', utilisateur: piege }] } as any);
    PageSecurite._moi = 'moi';
    await PageSecurite.chargerSessions();
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [{ id: 'k1', prenom: piege, nom: '', roles: 'enseignant' }] } as any);
    await PageSecurite.chargerBloques();
    const appels: any[] = [];
    const executer = (el: Element | null) => new Function('PageSecurite', el!.getAttribute('onclick') || '')({
      bloquer: (...a: any[]) => appels.push(['bloquer', ...a]), debloquer: (...a: any[]) => appels.push(['debloquer', ...a]),
    });
    executer(document.querySelector('#tb-sessions button.btn-d'));
    executer(document.querySelector('#tb-bloques button'));
    expect(appels).toEqual([['bloquer', 'u2', piege], ['debloquer', 'k1', piege + ' ']]);
    expect((window as any).__pwn).toBeUndefined();
  });

  it('Enseignants (Affecter / MDP) : le nom piégé arrive intact, sans exécuter de code', () => {
    document.body.innerHTML = '<table><tbody id="tb-ens"></tbody></table>';
    const piege = `Aïssa');window.__pwn=1;//`;
    PageEnseignants.renderTable([{ id: 'e1', prenom: piege, nom: 'Sow', matieres: [], classes: [] }]);
    const appels: any[] = [];
    const sandbox = { PageAffectations: { ouvrir: (...a: any[]) => appels.push(['affecter', ...a]) }, PageEnseignants: { renvoyerMdp: (...a: any[]) => appels.push(['mdp', ...a]) } };
    document.querySelectorAll('#tb-ens button[onclick*="PageAffectations"], #tb-ens button[onclick*="renvoyerMdp"]').forEach((b) => {
      new Function('PageAffectations', 'PageEnseignants', b.getAttribute('onclick') || '')(sandbox.PageAffectations, sandbox.PageEnseignants);
    });
    expect(appels).toEqual([['affecter', 'e1', piege + ' Sow'], ['mdp', 'e1', piege + ' Sow']]);
    expect((window as any).__pwn).toBeUndefined();
  });
});
