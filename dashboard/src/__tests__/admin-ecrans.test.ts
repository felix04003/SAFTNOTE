import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Api } from '../api';
import { construireCorps, PageAgenda } from '../pages/agenda';
import { construireCorpsPlage } from '../pages/plages';
import { resumeConsommation, PageSms } from '../pages/sms';
import { libelleAction, dateHeure, resumeAppareil, PageSecurite } from '../pages/securite';
import { effacementConfirme, nomFichierExport, PageDonnees } from '../pages/donnees';

afterEach(() => { vi.restoreAllMocks(); });

describe('agenda — construireCorps', () => {
  const base = { titre: 'Réunion de parents', type: 'reunion_parents', date_debut: '2026-11-10', date_fin: '' };

  it('une date de fin vide vaut la date de début ; champs facultatifs absents du corps', () => {
    const { corps } = construireCorps(base);
    expect(corps).toMatchObject({ titre: 'Réunion de parents', date_debut: '2026-11-10', date_fin: '2026-11-10', concerne_tout_etablissement: true, notif_programmee: false });
    expect(corps).not.toHaveProperty('lieu');
    expect(corps).not.toHaveProperty('heure_debut');
  });

  it.each([
    [{ titre: 'ab' }, /au moins 3/],
    [{ type: 'inconnu' }, /type/],
    [{ date_debut: '' }, /début/],
    [{ date_fin: '2026-11-09' }, /précède/],
    [{ heure_debut: '10:00', heure_fin: '09:00' }, /heure de fin/],
  ])('refuse %j', (changement, message) => {
    expect(construireCorps({ ...base, ...changement } as any).erreur).toMatch(message);
  });

  it('heure de fin plus tôt acceptée quand l\'événement dure plusieurs jours', () => {
    expect(construireCorps({ ...base, date_fin: '2026-11-12', heure_debut: '10:00', heure_fin: '09:00' }).erreur).toBeUndefined();
  });
});

describe('agenda — page', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><span id="ph-sous-agenda"></span><table><tbody id="tb-agenda"></tbody></table>';
    PageAgenda.data = [{ id: 'e1', titre: '<b>Sortie</b>', type: 'sortie_scolaire', date_debut: '2026-11-10T00:00:00.000Z', date_fin: '2026-11-12T00:00:00.000Z', heure_debut: '08:00:00', heure_fin: '17:00:00', lieu: 'Gorée' }];
  });

  it('affiche dates, heures, type lisible, et échappe le HTML du titre', () => {
    PageAgenda.rendre();
    const html = document.getElementById('tb-agenda')!.innerHTML;
    expect(html).toContain('10/11/2026 → 12/11/2026');
    expect(html).toContain('08:00–17:00');
    expect(html).toContain('Sortie scolaire');
    expect(html).not.toContain('<b>Sortie</b>');
    expect(document.getElementById('ph-sous-agenda')!.textContent).toBe('1 événement');
  });

  it('« À venir » demande a_venir au serveur, « Tous » non', async () => {
    const get = vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    await PageAgenda.changerFiltre('a_venir');
    await PageAgenda.changerFiltre('tous');
    expect(get.mock.calls.map((c) => c[1])).toEqual([{ a_venir: 'true' }, {}]);
  });

  it('modifier un événement efface les champs vidés (heure, lieu) et envoie une description vide plutôt que null', async () => {
    document.body.insertAdjacentHTML('beforeend',
      ['titre', 'type', 'debut', 'fin', 'heure-debut', 'heure-fin', 'lieu', 'description'].map((c) => `<input id="agd-${c}">`).join('') +
      '<input type="checkbox" id="agd-notif"><button id="btn-evenement-save"></button><div id="agd-err"></div><div id="m-evenement"></div>');
    (document.getElementById('agd-titre') as HTMLInputElement).value = 'Sortie à Gorée';
    (document.getElementById('agd-type') as HTMLInputElement).value = 'sortie_scolaire';
    (document.getElementById('agd-debut') as HTMLInputElement).value = '2026-11-10';
    PageAgenda._editionId = 'e1';
    const put = vi.spyOn(Api, 'put').mockResolvedValue({ data: {} } as any);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    await PageAgenda.enregistrer();
    expect(put.mock.calls[0][0]).toBe('/evenements/e1');
    expect(put.mock.calls[0][1]).toMatchObject({ heure_debut: null, heure_fin: null, lieu: null, description: '' });
  });
});

describe('plages — construireCorpsPlage', () => {
  const ok = { numero: '3', libelle: ' Récréation ', heure_debut: '09:30', heure_fin: '09:45', est_pause: true };

  it('corps normalisé', () => {
    expect(construireCorpsPlage(ok).corps).toEqual({ numero: 3, libelle: 'Récréation', heure_debut: '09:30', heure_fin: '09:45', est_pause: true });
  });

  it.each([
    [{ numero: '0' }, /numéro/], [{ numero: '2.5' }, /numéro/], [{ numero: '21' }, /numéro/],
    [{ heure_debut: '9h' }, /HH:MM/], [{ heure_fin: '09:30' }, /fin doit suivre/],
  ])('refuse %j', (changement, message) => {
    expect(construireCorpsPlage({ ...ok, ...changement }).erreur).toMatch(message);
  });
});

describe('sms', () => {
  it('sans plafond : on dit seulement combien sont partis', () => {
    expect(resumeConsommation({ utilises: 120, plafond: 0, pourcentage: null })).toEqual({ texte: '120 SMS envoyés ce mois-ci · pas de plafond', niveau: 'ok' });
  });
  it('sous 80 % : normal ; dès 80 % : attention', () => {
    expect(resumeConsommation({ utilises: 100, plafond: 300, pourcentage: 33 }).niveau).toBe('ok');
    expect(resumeConsommation({ utilises: 250, plafond: 300, pourcentage: 83 })).toMatchObject({ niveau: 'attention', texte: expect.stringContaining('bientôt atteint') });
  });
  it('100 % : notes et bulletins suspendus mais pas les urgences ; 150 % : tout suspendu', () => {
    const cent = resumeConsommation({ utilises: 300, plafond: 300, pourcentage: 100, notes_et_bulletins_bloques: true, urgences_bloquees: false });
    expect(cent).toMatchObject({ niveau: 'bloque', texte: expect.stringContaining('absences et sanctions encore envoyées') });
    expect(resumeConsommation({ utilises: 450, plafond: 300, pourcentage: 150, notes_et_bulletins_bloques: true, urgences_bloquees: true }).texte).toContain('tous les SMS');
  });

  it('plafond saisi : entier 0 à 100 000', () => {
    document.body.innerHTML = '<input id="sms-plafond">';
    const saisir = (v: string) => { (document.getElementById('sms-plafond') as HTMLInputElement).value = v; return PageSms.lirePlafond(); };
    expect(saisir('3000')).toEqual({ plafond: 3000 });
    expect(saisir('0')).toEqual({ plafond: 0 });
    for (const mauvais of ['', '-1', '1.5', 'abc', '100001']) expect(saisir(mauvais).erreur).toBeTruthy();
  });

  it('plafond 0 (illimité) demande confirmation et rien n\'est envoyé si on refuse', async () => {
    document.body.innerHTML = '<input id="sms-plafond" value="0"><div id="tc"></div>';
    window.confirm = vi.fn().mockReturnValue(false);
    const put = vi.spyOn(Api, 'put');
    await PageSms.enregistrer();
    expect(window.confirm).toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });
});

describe('sécurité — affichage', () => {
  it('libellés d\'action connus, sinon l\'action brute', () => {
    expect(libelleAction('utilisateurs.bloquer')).toBe('Compte bloqué');
    expect(libelleAction('notes.saisir')).toBe('notes.saisir');
  });
  it('date illisible : tiret', () => {
    expect(dateHeure(null)).toBe('—');
    expect(dateHeure('pas une date')).toBe('—');
    expect(dateHeure('2026-10-12T14:05:00')).toBe('12/10/2026 14:05');
  });
  it('appareil : canal + navigateur', () => {
    expect(resumeAppareil({ canal_connexion: 'web', user_agent: 'Mozilla/5.0 Chrome/120 Safari/537', appareil: 'desktop' })).toBe('Navigateur · Chrome · desktop');
    expect(resumeAppareil({ canal_connexion: 'mobile', user_agent: '' })).toBe('Application');
  });

  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><table><tbody id="tb-audit"></tbody><tbody id="tb-sessions"></tbody><tbody id="tb-bloques"></tbody></table>';
  });

  it('bloquer : un motif trop court n\'est pas envoyé ; annuler le prompt non plus', async () => {
    const post = vi.spyOn(Api, 'post');
    window.prompt = vi.fn().mockReturnValueOnce('abc').mockReturnValueOnce(null);
    await PageSecurite.bloquer('u1', 'Awa Diop');
    await PageSecurite.bloquer('u1', 'Awa Diop');
    expect(post).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('au moins 5 caractères');
  });

  it('bloquer avec motif : POST puis rechargement des trois listes', async () => {
    window.prompt = vi.fn().mockReturnValue('  Absence prolongée  ');
    const post = vi.spyOn(Api, 'post').mockResolvedValue({ data: {} } as any);
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [], meta: { total: 0 } } as any);
    await PageSecurite.bloquer('u1', 'Awa Diop');
    expect(post).toHaveBeenCalledWith('/securite/blocage/u1', { motif: 'Absence prolongée' });
    expect(vi.mocked(Api.get).mock.calls.map((c) => c[0]).sort()).toEqual(['/securite/audit', '/securite/comptes-bloques', '/securite/sessions']);
  });

  it('pas de bouton « Bloquer » sur sa propre session', async () => {
    document.body.innerHTML = '<table><tbody id="tb-sessions"></tbody></table>';
    PageSecurite._moi = 'moi';
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [
      { id: 's1', utilisateur_id: 'moi', utilisateur: 'Le Directeur' },
      { id: 's2', utilisateur_id: 'autre', utilisateur: 'Une Enseignante' },
    ] } as any);
    await PageSecurite.chargerSessions();
    const lignes = document.querySelectorAll('#tb-sessions tr');
    expect(lignes[0].textContent).toContain('vous');
    expect(lignes[0].textContent).not.toContain('Bloquer');
    expect(lignes[1].textContent).toContain('Bloquer le compte');
  });
});

describe('données personnelles (RGPD)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tc"></div><div id="donnees-conteneur"></div>';
    localStorage.setItem('em_user', JSON.stringify({ role: 'enseignant' }));
  });

  it('effacement : seulement avec le mot exact', () => {
    expect(effacementConfirme('supprimer')).toBe(true);
    expect(effacementConfirme('  SUPPRIMER ')).toBe(true);
    for (const non of ['', 'supprime', 'OUI', 'SUPPRIMER mon compte']) expect(effacementConfirme(non)).toBe(false);
  });

  it('nom du fichier d\'export daté', () => {
    expect(nomFichierExport(new Date('2026-10-16T10:00:00Z'))).toBe('mes-donnees-2026-10-16.json');
  });

  it('affiche les consentements accordés ; le bouton de suppression est inactif tant que le mot n\'est pas tapé', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [{ type: 'notifications_sms', accorde: true }] } as any);
    await PageDonnees.monter('donnees-conteneur');
    const case_ = (t: string) => document.querySelector(`input[data-consentement="${t}"]`) as HTMLInputElement;
    expect(case_('notifications_sms').checked).toBe(true);
    expect(case_('analytics').checked).toBe(false);

    const bouton = document.getElementById('btn-donnees-supprimer') as HTMLButtonElement;
    const saisie = document.getElementById('donnees-confirmation') as HTMLInputElement;
    expect(bouton.disabled).toBe(true);
    saisie.value = 'SUPPRIMER'; saisie.dispatchEvent(new Event('input'));
    expect(bouton.disabled).toBe(false);
    expect(document.body.textContent).toContain('membre du personnel');           // avertissement pour le personnel
  });

  it('un consentement refusé par le serveur est décoché à nouveau', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: [] } as any);
    await PageDonnees.monter('donnees-conteneur');
    vi.spyOn(Api, 'post').mockRejectedValue(new Error('refusé'));
    const box = document.querySelector('input[data-consentement="analytics"]') as HTMLInputElement;
    box.checked = true;
    await PageDonnees.changerConsentement(box);
    expect(box.checked).toBe(false);
    expect(box.disabled).toBe(false);
  });

  it('export : télécharge le JSON des données', async () => {
    vi.spyOn(Api, 'get').mockResolvedValue({ data: { compte: { nom: 'Sow' } } } as any);
    const tel = vi.fn();
    PageDonnees.telecharger = tel;
    await PageDonnees.exporter();
    expect(tel).toHaveBeenCalledWith(expect.stringMatching(/^mes-donnees-\d{4}-\d{2}-\d{2}\.json$/), expect.stringContaining('"nom": "Sow"'));
  });

  it('suppression confirmée : appelle l\'API, vide la session et quitte vers la connexion', async () => {
    vi.useFakeTimers();
    sessionStorage.setItem('em_token', 't');
    document.body.innerHTML = '<div id="tc"></div><input id="donnees-confirmation" value="SUPPRIMER">';
    window.confirm = vi.fn().mockReturnValue(true);
    const del = vi.spyOn(Api, 'del').mockResolvedValue({ data: { message: 'Anonymisé' } } as any);
    const quitter = vi.fn();
    PageDonnees.quitter = quitter;
    await PageDonnees.supprimer();
    expect(del).toHaveBeenCalledWith('/utilisateurs/moi');
    expect(sessionStorage.getItem('em_token')).toBeNull();
    expect(localStorage.getItem('em_user')).toBeNull();
    vi.advanceTimersByTime(1500);
    expect(quitter).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('seul directeur : le refus du serveur est affiché et la session n\'est PAS vidée', async () => {
    sessionStorage.setItem('em_token', 't');
    localStorage.setItem('em_user', JSON.stringify({ role: 'directeur' }));
    document.body.innerHTML = '<div id="tc"></div><input id="donnees-confirmation" value="SUPPRIMER">';
    window.confirm = vi.fn().mockReturnValue(true);
    vi.spyOn(Api, 'del').mockRejectedValue(new Error('Vous êtes le seul directeur de cet établissement'));
    const quitter = vi.fn();
    PageDonnees.quitter = quitter;
    await PageDonnees.supprimer();
    expect(document.body.textContent).toContain('seul directeur');
    expect(sessionStorage.getItem('em_token')).toBe('t');
    expect(localStorage.getItem('em_user')).not.toBeNull();
    expect(quitter).not.toHaveBeenCalled();
  });

  it('suppression sans le mot de confirmation : rien n\'est envoyé', async () => {
    document.body.innerHTML = '<div id="tc"></div><input id="donnees-confirmation" value="oui">';
    const del = vi.spyOn(Api, 'del');
    await PageDonnees.supprimer();
    expect(del).not.toHaveBeenCalled();
  });
});
