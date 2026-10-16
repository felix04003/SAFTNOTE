import { Api } from '../api';
import { toast } from '../ui';

/** Phrase d'état pour le directeur, d'après GET /notifications/sms/consommation */
export function resumeConsommation(c: any): { texte: string; niveau: 'ok' | 'attention' | 'bloque' } {
  const utilises = Number(c.utilises) || 0;
  const plafond = Number(c.plafond) || 0;
  if (plafond === 0) return { texte: utilises + ' SMS envoyés ce mois-ci · pas de plafond', niveau: 'ok' };
  const base = utilises + ' / ' + plafond + ' SMS (' + Math.round(Number(c.pourcentage) || 0) + ' %)';
  if (c.urgences_bloquees) return { texte: base + ' · tous les SMS de notification sont suspendus', niveau: 'bloque' };
  if (c.notes_et_bulletins_bloques) return { texte: base + ' · notes et bulletins suspendus, absences et sanctions encore envoyées', niveau: 'bloque' };
  if ((Number(c.pourcentage) || 0) >= 80) return { texte: base + ' · plafond bientôt atteint', niveau: 'attention' };
  return { texte: base, niveau: 'ok' };
}

export const PageSms: any = {
  async charger() {
    const zone = document.getElementById('sms-etat') as HTMLElement | null;
    if (!zone) return;
    try {
      const res = await Api.get('/notifications/sms/consommation');
      this.rendre(res.data || {});
    } catch (e: any) {
      zone.textContent = e.message || 'Consommation indisponible';
      const btn = document.getElementById('btn-sms-plafond') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
    }
  },

  rendre(c: any) {
    const zone = document.getElementById('sms-etat') as HTMLElement | null;
    const barre = document.getElementById('sms-barre') as HTMLElement | null;
    const champ = document.getElementById('sms-plafond') as HTMLInputElement | null;
    const r = resumeConsommation(c);
    if (zone) {
      zone.textContent = r.texte;
      zone.style.color = r.niveau === 'bloque' ? 'var(--rouge)' : r.niveau === 'attention' ? 'var(--warning)' : 'var(--g600)';
    }
    if (barre) barre.style.width = Math.min(100, Math.round(Number(c.pourcentage) || 0)) + '%';
    if (champ && c.plafond != null) champ.value = String(c.plafond);
  },

  /** Plafond saisi : entier de 0 (illimité) à 100 000 ; renvoie le nombre ou le message d'erreur */
  lirePlafond(): { plafond?: number; erreur?: string } {
    const brut = ((document.getElementById('sms-plafond') as HTMLInputElement | null)?.value || '').trim();
    const n = Number(brut);
    if (brut === '' || !Number.isInteger(n) || n < 0 || n > 100000) return { erreur: 'Le plafond est un nombre entier entre 0 (illimité) et 100 000' };
    return { plafond: n };
  },

  async enregistrer() {
    const { plafond, erreur } = this.lirePlafond();
    if (erreur || plafond === undefined) return toast(erreur || 'Plafond invalide', 'w');
    if (plafond === 0 && !confirm('Supprimer le plafond ? Les envois ne seront plus limités (coût non maîtrisé).')) return;
    try {
      const res = await Api.put('/notifications/sms/plafond', { plafond });
      this.rendre(res.data || {});
      toast('Plafond enregistré ✓', 's');
    } catch (e: any) {
      toast(e.message || 'Enregistrement impossible', 'e');
    }
  },
};

(window as any).PageSms = PageSms;
