import { Api } from '../api';
import { escapeHtml, toast } from '../ui';
import { CONFIG } from '../config';

export const CONSENTEMENTS: { type: string; titre: string; detail: string }[] = [
  { type: 'notifications_sms',      titre: 'Notifications par SMS',      detail: 'Absences, retards, sanctions et notes de vos enfants (ou de vos classes) envoyés par SMS.' },
  { type: 'notifications_whatsapp', titre: 'Notifications par WhatsApp', detail: 'Les mêmes informations, par WhatsApp.' },
  { type: 'partage_donnees',        titre: 'Partage de données',         detail: 'Partage de données avec les autres personnes autorisées de l\'établissement.' },
  { type: 'analytics',              titre: 'Mesure d\'usage',            detail: 'Statistiques anonymes pour améliorer l\'application.' },
];

export const MOT_CONFIRMATION = 'SUPPRIMER';

/** L'effacement est irréversible : il faut taper le mot exact (casse ignorée, espaces autour ignorés) */
export function effacementConfirme(saisie: string): boolean {
  return (saisie || '').trim().toUpperCase() === MOT_CONFIRMATION;
}

/** Nom du fichier d'export : mes-donnees-AAAA-MM-JJ.json */
export function nomFichierExport(date = new Date()): string {
  return 'mes-donnees-' + date.toISOString().slice(0, 10) + '.json';
}

export const PageDonnees: any = {
  _conteneur: 'donnees-conteneur',
  // Remplaçables dans les tests (jsdom n'a pas URL.createObjectURL ni de vraie navigation)
  telecharger: (nom: string, texte: string) => {
    const url = URL.createObjectURL(new Blob([texte], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = nom;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  quitter: () => { location.href = 'login.html'; },

  _role(): string {
    try { return String((JSON.parse(localStorage.getItem(CONFIG.USER_KEY) || 'null') || {}).role || '').toLowerCase(); } catch { return ''; }
  },

  async monter(conteneur?: string) {
    if (conteneur) this._conteneur = conteneur;
    const zone = document.getElementById(this._conteneur) as HTMLElement | null;
    if (!zone) return;

    let accordes: Record<string, boolean> = {};
    let erreur = '';
    try {
      const res = await Api.get('/utilisateurs/moi/consentements');
      for (const c of (res.data || [])) accordes[c.type] = !!c.accorde;
    } catch (e: any) { erreur = e.message || 'Consentements indisponibles'; }

    const personnel = this._role() !== 'parent';
    zone.innerHTML =
      '<div class="carte" style="margin-bottom:18px"><div class="ch"><span>🔔</span><span class="ct">Mes consentements</span></div><div class="cb">' +
        (erreur ? '<div class="login-err show" role="alert">' + escapeHtml(erreur) + '</div>' : '') +
        CONSENTEMENTS.map(function(c) {
          return '<label style="display:flex;gap:10px;align-items:flex-start;padding:8px 0;cursor:pointer">' +
            '<input type="checkbox" data-consentement="' + c.type + '"' + (accordes[c.type] ? ' checked' : '') + (erreur ? ' disabled' : '') + ' style="margin-top:3px">' +
            '<span><b>' + escapeHtml(c.titre) + '</b><br><span style="font-size:12px;color:var(--g500)">' + escapeHtml(c.detail) + '</span></span></label>';
        }).join('') +
      '</div></div>' +
      '<div class="carte" style="margin-bottom:18px"><div class="ch"><span>📥</span><span class="ct">Mes données</span></div><div class="cb">' +
        '<p style="font-size:13px;color:var(--g600);margin-bottom:12px">Téléchargez toutes les données personnelles que l\'application détient sur vous (compte, connexions, actions, consentements).</p>' +
        '<button id="btn-donnees-export" class="btn btn-p btn-sm">Télécharger mes données</button>' +
      '</div></div>' +
      '<div class="carte" style="border:1px solid var(--rouge)"><div class="ch"><span>⚠️</span><span class="ct" style="color:var(--rouge)">Supprimer mon compte</span></div><div class="cb">' +
        '<p style="font-size:13px;color:var(--g600);margin-bottom:8px">Vos informations personnelles (nom, téléphone, email, adresse) sont anonymisées et vous êtes déconnecté partout. ' +
          'Les données scolaires sont conservées sous forme anonyme, comme la réglementation l\'exige. <b>Cette action est irréversible.</b></p>' +
        (personnel ? '<p style="font-size:13px;color:var(--rouge);margin-bottom:8px">Vous êtes membre du personnel : votre accès à l\'établissement sera fermé. Si vous êtes le seul directeur, demandez d\'abord un autre accès de direction.</p>' : '') +
        '<div class="fg"><label class="fl" for="donnees-confirmation">Pour confirmer, tapez ' + MOT_CONFIRMATION + '</label><input class="fi" id="donnees-confirmation" autocomplete="off"></div>' +
        '<button id="btn-donnees-supprimer" class="btn btn-d btn-sm" disabled>Supprimer définitivement mon compte</button>' +
      '</div></div>';

    zone.querySelectorAll<HTMLInputElement>('input[data-consentement]').forEach((box) => {
      box.addEventListener('change', () => this.changerConsentement(box));
    });
    document.getElementById('btn-donnees-export')?.addEventListener('click', () => this.exporter());
    const saisie = document.getElementById('donnees-confirmation') as HTMLInputElement;
    const bouton = document.getElementById('btn-donnees-supprimer') as HTMLButtonElement;
    saisie.addEventListener('input', () => { bouton.disabled = !effacementConfirme(saisie.value); });
    bouton.addEventListener('click', () => this.supprimer());
  },

  async changerConsentement(box: HTMLInputElement) {
    const accorde = box.checked;
    box.disabled = true;
    try {
      await Api.post('/utilisateurs/moi/consentement', { type: box.dataset.consentement, accorde });
      toast(accorde ? 'Consentement enregistré ✓' : 'Consentement retiré ✓', 's');
    } catch (e: any) {
      box.checked = !accorde;                      // le serveur a refusé : l'écran ne doit pas mentir
      toast(e.message || 'Enregistrement impossible', 'e');
    } finally { box.disabled = false; }
  },

  async exporter() {
    try {
      const res = await Api.get('/utilisateurs/moi/donnees');
      this.telecharger(nomFichierExport(), JSON.stringify(res.data, null, 2));
      toast('Export téléchargé ✓', 's');
    } catch (e: any) {
      toast(e.message || 'Export impossible', 'e');
    }
  },

  async supprimer() {
    const saisie = (document.getElementById('donnees-confirmation') as HTMLInputElement | null)?.value || '';
    if (!effacementConfirme(saisie)) return toast('Tapez ' + MOT_CONFIRMATION + ' pour confirmer', 'w');
    if (!confirm('Dernière confirmation : supprimer définitivement votre compte ?')) return;
    try {
      const res = await Api.del('/utilisateurs/moi');
      toast((res.data && (res.data as any).message) || 'Compte anonymisé', 's');
      sessionStorage.removeItem(CONFIG.TOKEN_KEY);
      sessionStorage.removeItem(CONFIG.REFRESH_TOKEN_KEY);
      localStorage.removeItem(CONFIG.USER_KEY);
      setTimeout(() => this.quitter(), 1200);
    } catch (e: any) {
      toast(e.message || 'Suppression impossible', 'e');
    }
  },
};

(window as any).PageDonnees = PageDonnees;
