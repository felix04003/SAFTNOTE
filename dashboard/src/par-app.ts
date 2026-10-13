import { Api } from './api';
import { Auth } from './auth';
import { escapeHtml } from './ui';
import { PAR_HOOKS, PAR_TITRES, goto } from './par-router';
import { Notifs } from './notifs';
import { CONFIG } from './config';

export const ParApp = {
  _enfants: [] as any[],
  _enfantActif: null as any,

  enfantId() {
    return ParApp._enfantActif ? ParApp._enfantActif.eleve_utilisateur_id : null;
  },

  enfantLien() {
    return ParApp._enfantActif || {};
  },

  async _chargerEnfants() {
    try {
      var res = await Api.get('/parents/moi/enfants');
      ParApp._enfants = res.data || [];
    } catch (e) {
      ParApp._enfants = [];
    }
  },

  _activerEnfant(id: any) {
    var enfant = ParApp._enfants.find(function(e: any) { return e.eleve_utilisateur_id === id; });
    if (!enfant && ParApp._enfants.length) enfant = ParApp._enfants[0];
    ParApp._enfantActif = enfant || null;
    if (enfant) localStorage.setItem('par_enfant_actif', enfant.eleve_utilisateur_id);
  },

  // Écoles où ce numéro a un compte parent (3.4). Liste vide ou d'une école : pas de sélecteur.
  async _chargerEcoles(): Promise<Array<{ code: string; nom: string; courant: boolean }>> {
    try {
      var res = await Api.get('/auth/mes-etablissements');
      return res.data || [];
    } catch (e) {
      return [];
    }
  },

  // Crée le <select> d'écoles ; basculer ouvre une session dans l'autre école (l'ancienne reste valable)
  _construireSelecteurEcole(ecoles: Array<{ code: string; nom: string; courant: boolean }>, sel: HTMLSelectElement) {
    sel.textContent = '';
    ecoles.forEach(function(e) {
      var opt = document.createElement('option');
      opt.value = e.code;
      opt.textContent = e.nom;           // textContent : le nom vient du serveur
      if (e.courant) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.style.display = '';
    sel.addEventListener('change', async function() {
      sel.disabled = true;
      try {
        var res = await Api.post('/auth/changer-etablissement', { etablissement_code: sel.value });
        var d: any = res.data;
        sessionStorage.setItem(CONFIG.TOKEN_KEY, d.token);
        if (d.refresh_token) sessionStorage.setItem(CONFIG.REFRESH_TOKEN_KEY, d.refresh_token);
        localStorage.setItem(CONFIG.USER_KEY, JSON.stringify(d.utilisateur));
        localStorage.removeItem('par_enfant_actif');    // les enfants changent avec l'école
        window.location.reload();
      } catch (e) {
        sel.disabled = false;
        var courante = ecoles.find(function(x) { return x.courant; });
        if (courante) sel.value = courante.code;
      }
    });
  },

  _peuplerSidebar() {
    var user = Auth.getUser();
    var nomEl    = document.getElementById('sb-user-nom');
    var roleEl   = document.getElementById('sb-user-role');
    var avatarEl = document.getElementById('sb-user-avatar');
    var etabEl   = document.getElementById('sb-etab-nom');
    if (nomEl)    nomEl.textContent    = (user && user.prenom ? user.prenom + ' ' : '') + (user && user.nom ? user.nom : '');
    if (roleEl)   roleEl.textContent   = 'Parent';
    if (avatarEl) avatarEl.textContent = (user && user.prenom && user.nom) ? (user.prenom[0] + user.nom[0]).toUpperCase() : 'P';
    if (etabEl)   etabEl.textContent   = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
  },

  _peuplerSelecteur() {
    var sel = document.getElementById('par-enfant-sel') as HTMLSelectElement;
    if (!sel) return;
    if (ParApp._enfants.length <= 1) {
      var conteneur = document.getElementById('par-enfant-wrap');
      if (conteneur && ParApp._enfantActif) {
        conteneur.innerHTML =
          '<div style="font-size:9px;opacity:.5;margin-bottom:4px;letter-spacing:.5px;text-transform:uppercase">Mon enfant</div>' +
          '<div style="font-size:11px;font-weight:600">' +
            escapeHtml(ParApp._enfantActif.prenom || '') + ' ' + escapeHtml(ParApp._enfantActif.nom || '') +
          '</div>' +
          '<div style="font-size:9px;opacity:.5">' + escapeHtml(ParApp._enfantActif.classe || '') + '</div>';
      }
      return;
    }
    sel.innerHTML = ParApp._enfants.map(function(e: any) {
      return '<option value="' + escapeHtml(String(e.eleve_utilisateur_id || '')) + '">' +
        escapeHtml(e.prenom || '') + ' ' + escapeHtml(e.nom || '') +
        (e.classe ? ' — ' + e.classe : '') +
      '</option>';
    }).join('');
    if (ParApp._enfantActif) sel.value = ParApp._enfantActif.eleve_utilisateur_id;
    sel.addEventListener('change', function() {
      ParApp._activerEnfant(sel.value);
      var pageActive = document.querySelector('.page.active');
      if (pageActive) {
        var id = (pageActive as HTMLElement).id.replace('page-', '');
        if (PAR_HOOKS[id]) PAR_HOOKS[id]();
      }
    });
  },
};

(window as any).ParApp = ParApp;

document.addEventListener('DOMContentLoaded', async function() {
  if (!Auth.requireAuth()) return;
  var user = Auth.getUser();
  var role = (user && user.role) ? user.role.toLowerCase() : '';
  if (role !== 'parent') { window.location.href = 'index.html'; return; }

  var ecoles = await ParApp._chargerEcoles();
  await ParApp._chargerEnfants();
  if (!ParApp._enfants.length) {
    document.body.innerHTML = '<div style="display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;min-height:100vh;font-family:Sora,sans-serif;color:#64748b"><div>Aucun enfant lié à votre compte dans cet établissement.</div><select id="par-ecole-sel" aria-label="Établissement" style="display:none;padding:6px 10px;border-radius:6px;border:1px solid #cbd5e1"></select></div>';
    var selVide = document.getElementById('par-ecole-sel') as HTMLSelectElement;
    if (ecoles.length > 1) ParApp._construireSelecteurEcole(ecoles, selVide);
    return;
  }
  var selEcole = document.getElementById('par-ecole-sel') as HTMLSelectElement | null;
  if (selEcole && ecoles.length > 1) ParApp._construireSelecteurEcole(ecoles, selEcole);

  var dernier = localStorage.getItem('par_enfant_actif');
  ParApp._activerEnfant(dernier);
  ParApp._peuplerSidebar();
  ParApp._peuplerSelecteur();
  Notifs.init();

  var dateEl = document.getElementById('ph-sous-date');
  if (dateEl) {
    var now = new Date();
    var opts: any = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    var dateStr = now.toLocaleDateString('fr-FR', opts);
    dateStr = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
    var etab = (user && user.etablissement_nom) ? user.etablissement_nom : 'EcoleManager';
    dateEl.textContent = etab + ' · ' + dateStr;
  }

  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) logoutBtn.addEventListener('click', function(e) { e.preventDefault(); Auth.logout(); });

  var hash = location.hash.slice(1);
  if (hash && PAR_TITRES[hash]) goto(hash);
  else goto('par-dashboard');
});
