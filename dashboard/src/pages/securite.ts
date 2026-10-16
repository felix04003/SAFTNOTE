import { Api } from '../api';
import { escapeHtml, toast } from '../ui';
import { PAGE_HOOKS } from '../router';

const LIBELLES_ACTION: Record<string, string> = {
  'utilisateurs.bloquer':   'Compte bloqué',
  'utilisateurs.creer_directeur': 'Directeur nommé',
  'utilisateurs.debloquer': 'Compte débloqué',
  'securite.politique':     'Politique de sécurité modifiée',
  'connexion':              'Connexion',
  'deconnexion':            'Déconnexion',
};

export function libelleAction(action: string): string {
  return LIBELLES_ACTION[action] || action || '—';
}

/** « 12/10/2026 14:05 » (heure locale du navigateur) ; « — » si la date est illisible */
export function dateHeure(iso: any): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

/** Navigateur ou application, d'après le user-agent (court : il n'est là que pour reconnaître un appareil) */
export function resumeAppareil(s: any): string {
  const ua = String(s.user_agent || '');
  const canal = s.canal_connexion === 'mobile' ? 'Application' : 'Navigateur';
  const nav = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return canal + (nav ? ' · ' + nav : '') + (s.appareil ? ' · ' + s.appareil : '');
}

const TAILLE_PAGE = 15;

export const PageSecurite: any = {
  _page: 1,
  _total: 0,
  _filtreAction: '',
  _moi: '',

  async charger() {
    try { this._moi = (JSON.parse(localStorage.getItem('em_user') || 'null') || {}).id || ''; } catch { this._moi = ''; }
    await Promise.all([this.chargerAudit(), this.chargerSessions(), this.chargerBloques()]);
  },

  // ── Journal d'audit ──────────────────────────────────────────────
  async chargerAudit() {
    const corps = document.getElementById('tb-audit') as HTMLElement | null;
    if (!corps) return;
    try {
      const params: Record<string, any> = { page: this._page, limite: TAILLE_PAGE };
      if (this._filtreAction) params.action = this._filtreAction;
      const res = await Api.get('/securite/audit', params);
      this._total = (res.meta && res.meta.total) || 0;
      const lignes = res.data || [];
      corps.innerHTML = lignes.length ? lignes.map(function(a: any) {
        return '<tr>' +
          '<td style="white-space:nowrap">' + escapeHtml(dateHeure(a.created_at)) + '</td>' +
          '<td>' + escapeHtml(a.utilisateur || 'Système') + '</td>' +
          '<td>' + escapeHtml(libelleAction(a.action)) + '</td>' +
          '<td>' + escapeHtml(a.table_cible || '—') + '</td>' +
          '<td><span class="badge ' + (a.resultat === 'succes' ? 'bs' : 'bd') + '">' + escapeHtml(a.resultat || '—') + '</span></td>' +
          '<td style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--g400)">' + escapeHtml(a.ip_address || '—') + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--g400)">Aucune entrée</td></tr>';

      const pages = Math.max(1, Math.ceil(this._total / TAILLE_PAGE));
      const info = document.getElementById('audit-pagination') as HTMLElement | null;
      if (info) info.textContent = 'Page ' + this._page + ' / ' + pages + ' · ' + this._total + ' entrée' + (this._total > 1 ? 's' : '');
      const prec = document.getElementById('audit-prec') as HTMLButtonElement | null;
      const suiv = document.getElementById('audit-suiv') as HTMLButtonElement | null;
      if (prec) prec.disabled = this._page <= 1;
      if (suiv) suiv.disabled = this._page >= pages;
    } catch (e: any) {
      corps.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--rouge)">' + escapeHtml(e.message || 'Journal indisponible') + '</td></tr>';
    }
  },

  pageAudit(delta: number) {
    const pages = Math.max(1, Math.ceil(this._total / TAILLE_PAGE));
    this._page = Math.min(pages, Math.max(1, this._page + delta));
    return this.chargerAudit();
  },

  filtrerAudit(action: string) {
    this._filtreAction = action;
    this._page = 1;
    return this.chargerAudit();
  },

  // ── Sessions actives ─────────────────────────────────────────────
  async chargerSessions() {
    const corps = document.getElementById('tb-sessions') as HTMLElement | null;
    if (!corps) return;
    const moi = this._moi;
    try {
      const res = await Api.get('/securite/sessions');
      const lignes = res.data || [];
      corps.innerHTML = lignes.length ? lignes.map(function(s: any) {
        return '<tr>' +
          '<td class="nc">' + escapeHtml(s.utilisateur) + (s.utilisateur_id === moi ? ' <span class="badge bi">vous</span>' : '') + '</td>' +
          '<td>' + escapeHtml(resumeAppareil(s)) + '</td>' +
          '<td style="font-family:\'Space Mono\',monospace;font-size:11px;color:var(--g400)">' + escapeHtml(s.ip_address || '—') + '</td>' +
          '<td>' + escapeHtml(dateHeure(s.derniere_activite)) + '</td>' +
          '<td style="display:flex;gap:5px">' +
            '<button class="btn btn-l btn-sm" onclick="PageSecurite.revoquer(\'' + escapeHtml(s.id) + '\')">Déconnecter</button>' +
            (s.utilisateur_id === moi ? '' :
              '<button class="btn btn-d btn-sm" onclick="PageSecurite.bloquer(\'' + escapeHtml(s.utilisateur_id) + '\',\'' + escapeHtml(s.utilisateur) + '\')">Bloquer le compte</button>') +
          '</td></tr>';
      }).join('') : '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--g400)">Aucune session active</td></tr>';
    } catch (e: any) {
      corps.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--rouge)">' + escapeHtml(e.message || 'Sessions indisponibles') + '</td></tr>';
    }
  },

  async revoquer(id: string) {
    if (!confirm('Déconnecter cet appareil ? La personne devra se reconnecter.')) return;
    try {
      await Api.del('/securite/sessions/' + id);
      toast('Appareil déconnecté ✓', 's');
      await this.chargerSessions();
    } catch (e: any) {
      toast(e.message || 'Déconnexion impossible', 'e');
    }
  },

  // ── Blocage / déblocage (même route : le serveur inverse l'état du compte) ──
  async bloquer(userId: string, nom: string) {
    const motif = prompt('Bloquer le compte de ' + nom + ' : toutes ses sessions seront fermées.\nMotif (5 caractères minimum, inscrit au journal) :');
    if (motif === null) return;
    await this._basculer(userId, motif, nom + ' : compte bloqué ✓');
  },

  async debloquer(userId: string, nom: string) {
    const motif = prompt('Débloquer le compte de ' + nom + '.\nMotif (5 caractères minimum, inscrit au journal) :', 'Compte rétabli');
    if (motif === null) return;
    await this._basculer(userId, motif, nom + ' : compte débloqué ✓');
  },

  async _basculer(userId: string, motif: string, message: string) {
    if (motif.trim().length < 5) return toast('Le motif doit contenir au moins 5 caractères', 'w');
    try {
      await Api.post('/securite/blocage/' + userId, { motif: motif.trim() });
      toast(message, 's');
      await this.charger();
    } catch (e: any) {
      toast(e.message || 'Opération impossible', 'e');
    }
  },

  // ── Nomination d'un second directeur ──
  async nommerDirecteur() {
    const val = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value || '').trim();
    const corps: Record<string, string> = { prenom: val('dir-prenom'), nom: val('dir-nom'), telephone: val('dir-tel') };
    if (val('dir-email')) corps.email = val('dir-email');
    if (corps.prenom.length < 2 || corps.nom.length < 2 || corps.telephone.length < 6) {
      return toast('Prénom, nom et téléphone sont obligatoires', 'w');
    }
    if (!confirm('Nommer ' + corps.prenom + ' ' + corps.nom + ' directeur ? Cette personne aura tous les droits de direction.')) return;
    const bouton = document.getElementById('dir-creer') as HTMLButtonElement | null;
    if (bouton) bouton.disabled = true;
    try {
      const res = await Api.post('/securite/directeurs', corps);
      ['dir-prenom', 'dir-nom', 'dir-tel', 'dir-email'].forEach((id) => { const e = document.getElementById(id) as HTMLInputElement | null; if (e) e.value = ''; });
      const sms = res.data && res.data.sms_envoye;
      // Sans SMS, le mot de passe provisoire est dans le message : il faut le montrer entièrement
      if (sms) toast('Directeur nommé ✓ Mot de passe provisoire envoyé par SMS', 's');
      else alert((res.data && res.data.message) || 'Directeur nommé');
      await this.chargerAudit();
    } catch (e: any) {
      toast(e.message || 'Nomination impossible', 'e');
    } finally {
      if (bouton) bouton.disabled = false;
    }
  },

  async chargerBloques() {
    const corps = document.getElementById('tb-bloques') as HTMLElement | null;
    if (!corps) return;
    try {
      const res = await Api.get('/securite/comptes-bloques');
      const lignes = res.data || [];
      corps.innerHTML = lignes.length ? lignes.map(function(c: any) {
        return '<tr>' +
          '<td class="nc">' + escapeHtml((c.prenom || '') + ' ' + (c.nom || '')) + '</td>' +
          '<td>' + escapeHtml(c.roles || '—') + '</td>' +
          '<td>' + escapeHtml(dateHeure(c.bloque_depuis)) + '</td>' +
          '<td><button class="btn btn-p btn-sm" onclick="PageSecurite.debloquer(\'' + escapeHtml(c.id) + '\',\'' + escapeHtml((c.prenom || '') + ' ' + (c.nom || '')) + '\')">Débloquer</button></td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--g400)">Aucun compte bloqué</td></tr>';
    } catch (e: any) {
      corps.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:var(--rouge)">' + escapeHtml(e.message || 'Liste indisponible') + '</td></tr>';
    }
  },

  init() { this._page = 1; this.charger(); },
};

(window as any).PageSecurite = PageSecurite;
PAGE_HOOKS['securite'] = () => PageSecurite.init();
