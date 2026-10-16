import { Api } from '../api';
import { escapeHtml, toast, openModal, closeModal } from '../ui';
import { PAGE_HOOKS } from '../router';
import { PagePlages } from './plages';
import { PageSms } from './sms';

export const PageParametres: any = {
  async charger() {
    try {
      const res = await Api.get('/etablissement');
      this.remplirFormulaire(res.data);
    } catch (e: any) {
      console.warn('PageParametres: fallback statique —', e.message);
    }
    await this.chargerMatieres();
    await this.chargerCoefficients();
  },

  remplirFormulaire: function(etab: any) {
    const set = function(id: string, val: any) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el && val != null) el.value = val;
    };
    set('param-nom',   etab.nom);
    set('param-code',  etab.code_officiel);
    set('param-ville', etab.ville);
    set('param-tel',   etab.telephone);
    set('param-email', etab.email);
    set('param-annee', etab.annee_courante || (etab.annee_scolaire && etab.annee_scolaire.libelle));
    if (etab.at_api_key_configured) {
      const atEl = document.getElementById('param-at-key') as HTMLInputElement | null;
      if (atEl) atEl.placeholder = 'Configurée ✓ (laissez vide pour conserver)';
    }
    if (etab.wa_token_configured) {
      const waEl = document.getElementById('param-wa-token') as HTMLInputElement | null;
      if (waEl) waEl.placeholder = 'Configuré ✓ (laissez vide pour conserver)';
    }
  },

  sauvegarder: async function() {
    const getVal = (id: string) => {
      const el = document.getElementById(id) as HTMLInputElement | null;
      return el ? el.value.trim() : '';
    };
    const payload: Record<string, any> = {};
    const nom   = getVal('param-nom');
    const ville = getVal('param-ville');
    const tel   = getVal('param-tel');
    const email = getVal('param-email');

    if (nom)   payload['nom']       = nom;
    if (ville) payload['ville']     = ville;
    if (tel)   payload['telephone'] = tel;
    if (email) payload['email']     = email;

    if (!Object.keys(payload).length) return toast('Aucune modification détectée', 'w');

    const btn = document.getElementById('btn-param-save') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }

    try {
      await Api.put('/etablissement', payload);
      toast('Paramètres enregistrés ✓', 's');
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Sauvegarde échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '💾 Enregistrer'; }
    }
  },

  // ── Matières ────────────────────────────────────────────────────

  async chargerMatieres() {
    const liste = document.getElementById('param-matieres-liste') as HTMLElement | null;
    if (!liste) return;
    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>';
    try {
      const res = await Api.get('/configs/matieres');
      const matieres = res.data || [];
      this.matieresCache = matieres;

      const discSel = document.getElementById('m-mat-discipline') as HTMLSelectElement | null;
      if (discSel) {
        const disciplinesVues: Record<string, string> = {};
        matieres.forEach(function(m: any) {
          if (m.discipline_id && !disciplinesVues[m.discipline_id]) {
            disciplinesVues[m.discipline_id] = m.discipline;
          }
        });
        const discOptions = Object.keys(disciplinesVues).map(function(id) {
          return '<option value="' + escapeHtml(id) + '">' + escapeHtml(disciplinesVues[id]) + '</option>';
        });
        discSel.innerHTML = '<option value="">— Aucune discipline —</option>' + discOptions.join('');
      }

      if (!matieres.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucune matière — cliquez sur « + Nouvelle matière » pour commencer.</div>';
        return;
      }
      liste.innerHTML = matieres.map(function(m: any) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--g100)">' +
          '<span style="font-size:13px"><strong>' + escapeHtml(m.nom) + '</strong>' +
          (m.nom_court ? ' <span style="color:var(--g400);font-size:11px">(' + escapeHtml(m.nom_court) + ')</span>' : '') +
          ' <span class="badge bo" style="font-size:10px">' + escapeHtml(m.code) + '</span>' +
          (m.discipline ? ' · ' + escapeHtml(m.discipline) : '') +
          (!m.actif ? ' <span class="badge bd" style="font-size:10px">Inactif</span>' : '') +
          '</span>' +
          '<span style="white-space:nowrap">' +
            '<button class="btn btn-l btn-sm" onclick="PageParametres.modifierMatiere(\'' + escapeHtml(m.id) + '\')">Modifier</button> ' +
            (m.actif
              ? '<button class="btn btn-l btn-sm" onclick="PageParametres.archiverMatiere(\'' + escapeHtml(m.id) + '\')">Archiver</button>'
              : '<button class="btn btn-p btn-sm" onclick="PageParametres.reactiverMatiere(\'' + escapeHtml(m.id) + '\')">Réactiver</button>') +
          '</span>' +
        '</div>';
      }).join('');
    } catch {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">Impossible de charger les matières</div>';
    }
  },

  _matEditId: '',

  _modeModaleMatiere: function(edition: boolean) {
    const titre = document.getElementById('m-mat-titre') as HTMLElement | null;
    if (titre) titre.textContent = edition ? 'Modifier la matière' : 'Nouvelle matière';
    const btn = document.getElementById('btn-creer-matiere') as HTMLButtonElement | null;
    if (btn) btn.textContent = edition ? 'Enregistrer' : 'Créer la matière';
  },

  ouvrirNouvelleMatiere: function() {
    this._matEditId = '';
    this._modeModaleMatiere(false);
    ['m-mat-nom', 'm-mat-court', 'm-mat-code'].forEach(function(id) {
      const el = document.getElementById(id) as HTMLInputElement | null;
      if (el) el.value = '';
    });
    openModal('m-matiere');
  },

  modifierMatiere: function(id: string) {
    const m = (this.matieresCache || []).find(function(x: any) { return x.id === id; });
    if (!m) return;
    this._matEditId = id;
    this._modeModaleMatiere(true);
    const champ = (cible: string, valeur: any) => { const el = document.getElementById(cible) as HTMLInputElement | null; if (el) el.value = valeur == null ? '' : String(valeur); };
    champ('m-mat-nom', m.nom); champ('m-mat-court', m.nom_court); champ('m-mat-code', m.code);
    champ('m-mat-moyenne', m.compte_dans_moyenne === false ? 'false' : 'true');
    champ('m-mat-discipline', m.discipline_id);
    openModal('m-matiere');
  },

  async archiverMatiere(id: string) {
    const m = (this.matieresCache || []).find(function(x: any) { return x.id === id; });
    const nom = m ? m.nom : 'cette matière';
    if (!confirm('Archiver « ' + nom + ' » ?\nElle n\'apparaît plus dans les choix ; les notes et bulletins passés sont conservés. Impossible tant qu\'un enseignant y est affecté cette année.')) return;
    try {
      await Api.del('/configs/matieres/' + id);
      toast('Matière « ' + nom + ' » archivée ✓', 's');
      await this.chargerMatieres();
    } catch (e: any) {
      toast(e.message || 'Archivage impossible', 'e');
    }
  },

  async reactiverMatiere(id: string) {
    try {
      await Api.put('/configs/matieres/' + id, { actif: true });
      toast('Matière réactivée ✓', 's');
      await this.chargerMatieres();
    } catch (e: any) {
      toast(e.message || 'Réactivation impossible', 'e');
    }
  },

  async creerMatiere() {
    const nom          = (document.getElementById('m-mat-nom')       as HTMLInputElement  | null)?.value?.trim();
    const court        = (document.getElementById('m-mat-court')     as HTMLInputElement  | null)?.value?.trim();
    const code         = (document.getElementById('m-mat-code')      as HTMLInputElement  | null)?.value?.trim().toUpperCase();
    const moyenne      = (document.getElementById('m-mat-moyenne')   as HTMLSelectElement | null)?.value === 'true';
    const disciplineId = (document.getElementById('m-mat-discipline') as HTMLSelectElement | null)?.value || undefined;

    if (!nom)  return toast('Le nom est obligatoire', 'w');
    if (!code) return toast('Le code est obligatoire', 'w');

    const btn = document.getElementById('btn-creer-matiere') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      if (this._matEditId) {
        await Api.put('/configs/matieres/' + this._matEditId, {
          nom, nom_court: court || null, code, compte_dans_moyenne: moyenne, discipline_id: disciplineId || null,
        });
      } else {
        await Api.post('/configs/matieres', {
          nom,
          nom_court: court || undefined,
          code,
          compte_dans_moyenne: moyenne,
          discipline_id: disciplineId || undefined,
        });
      }
      closeModal('m-matiere');
      toast('Matière « ' + nom + ' » ' + (this._matEditId ? 'modifiée' : 'créée') + ' ✓', 's');
      this._matEditId = '';
      ['m-mat-nom', 'm-mat-court', 'm-mat-code'].forEach(function(id) {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = '';
      });
      await this.chargerMatieres();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = this._matEditId ? 'Enregistrer' : 'Créer la matière'; }
    }
  },

  // ── Coefficients ────────────────────────────────────────────────

  async chargerCoefficients() {
    const liste = document.getElementById('param-coefficients-liste') as HTMLElement | null;
    if (!liste) return;
    liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Chargement…</div>';
    try {
      const res = await Api.get('/configs/coefficients');
      const niveaux = (res.data && res.data.niveaux) || [];
      this.niveauxCoefCache = niveaux;

      if (!niveaux.length) {
        liste.innerHTML = '<div style="color:var(--g400);font-size:13px;padding:10px">Aucun coefficient configuré — cliquez sur « + Assigner un coefficient » pour commencer.</div>';
        return;
      }
      liste.innerHTML = niveaux.map(function(n: any) {
        const lignes = n.matieres.map(function(m: any) {
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 0 5px 14px;font-size:12.5px">' +
            '<span>' + escapeHtml(m.matiere) + (m.serie ? ' <span style="color:var(--g400)">(' + escapeHtml(m.serie) + ')</span>' : '') + '</span>' +
            '<span class="badge bo" style="font-size:10px">coef. ' + escapeHtml(String(m.coefficient)) + '</span>' +
          '</div>';
        }).join('');
        return '<div style="padding:6px 0;border-bottom:1px solid var(--g100)">' +
          '<div style="font-size:12px;font-weight:700;color:var(--g500)">' + escapeHtml(n.niveau) + '</div>' +
          lignes +
        '</div>';
      }).join('');
    } catch {
      liste.innerHTML = '<div style="color:var(--rouge);font-size:13px;padding:10px">Impossible de charger les coefficients</div>';
    }
  },

  async ouvrirModalCoefficient() {
    const niveauSel  = document.getElementById('m-coef-niveau')  as HTMLSelectElement | null;
    const matiereSel = document.getElementById('m-coef-matiere') as HTMLSelectElement | null;

    if (matiereSel) {
      const matieres = this.matieresCache || [];
      matiereSel.innerHTML = matieres.length
        ? matieres.map(function(m: any) { return '<option value="' + escapeHtml(m.id) + '">' + escapeHtml(m.nom) + '</option>'; }).join('')
        : '<option value="">Aucune matière — créez-en une d\'abord</option>';
    }

    if (niveauSel) {
      niveauSel.innerHTML = '<option value="">Chargement des niveaux…</option>';
      try {
        const res = await Api.get('/niveaux');
        const niveaux = res.data || [];
        this.niveauxCache = niveaux;
        niveauSel.innerHTML = niveaux.length
          ? niveaux.map(function(n: any) { return '<option value="' + escapeHtml(n.id) + '">' + escapeHtml(n.nom) + '</option>'; }).join('')
          : '<option value="">Aucun niveau configuré</option>';
      } catch {
        niveauSel.innerHTML = '<option value="">Erreur de chargement</option>';
      }
    }

    openModal('m-coefficient');
  },

  async assignerCoefficient() {
    const niveauId      = (document.getElementById('m-coef-niveau')      as HTMLSelectElement | null)?.value;
    const matiereId     = (document.getElementById('m-coef-matiere')     as HTMLSelectElement | null)?.value;
    const coefficient   = parseFloat((document.getElementById('m-coef-coefficient') as HTMLInputElement | null)?.value || '');
    const estObligatoire = (document.getElementById('m-coef-obligatoire') as HTMLSelectElement | null)?.value === 'true';

    if (!niveauId)  return toast('Le niveau est obligatoire', 'w');
    if (!matiereId) return toast('La matière est obligatoire', 'w');
    if (!coefficient || coefficient < 0.5 || coefficient > 10) return toast('Coefficient invalide (0.5 à 10)', 'w');

    const btn = document.getElementById('btn-assigner-coefficient') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Assignation…'; }

    try {
      await Api.post('/configs/coefficients', {
        matiere_id: matiereId,
        niveau_id: niveauId,
        coefficient,
        est_obligatoire: estObligatoire,
      });
      closeModal('m-coefficient');
      toast('Coefficient assigné ✓', 's');
      await this.chargerCoefficients();
    } catch (e: any) {
      toast('Erreur : ' + (e.message || 'Assignation échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Assigner'; }
    }
  },

  // ── Politique de sécurité (GET/PUT /securite/politique) ────────────

  CHAMPS_POLITIQUE: [
    { cle: 'mdp_longueur_min',        id: 'pol-mdp-longueur', min: 8, max: 32,  libelle: 'La longueur du mot de passe' },
    { cle: 'session_max_simultanees', id: 'pol-sessions',     min: 1, max: 5,   libelle: 'Le nombre d\'appareils' },
    { cle: 'blocage_nb_tentatives',   id: 'pol-tentatives',   min: 3, max: 10,  libelle: 'Le nombre de tentatives' },
    { cle: 'blocage_duree_minutes',   id: 'pol-blocage',      min: 5, max: 120, libelle: 'La durée du blocage' },
  ],

  async chargerPolitique() {
    try {
      const res = await Api.get('/securite/politique');
      const p = res.data || {};
      this.CHAMPS_POLITIQUE.forEach(function(c: any) {
        const el = document.getElementById(c.id) as HTMLInputElement | null;
        if (el && p[c.cle] != null) el.value = String(p[c.cle]);
      });
    } catch (e: any) {
      // Sans la permission config.voir (ou hors ligne) : la carte reste vide et inactive
      const btn = document.getElementById('btn-politique-save') as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
    }
  },

  // Lit et valide les champs ; renvoie le corps à envoyer ou le message d'erreur
  lirePolitique(): { corps?: Record<string, number>; erreur?: string } {
    const corps: Record<string, number> = {};
    for (const c of this.CHAMPS_POLITIQUE) {
      const el = document.getElementById(c.id) as HTMLInputElement | null;
      const brut = el ? el.value.trim() : '';
      const n = Number(brut);
      if (brut === '' || !Number.isInteger(n) || n < c.min || n > c.max) {
        return { erreur: c.libelle + ' doit être un nombre entier entre ' + c.min + ' et ' + c.max + '.' };
      }
      corps[c.cle] = n;
    }
    return { corps };
  },

  async sauvegarderPolitique() {
    const errEl = document.getElementById('politique-err') as HTMLElement | null;
    if (errEl) errEl.classList.remove('show');
    const { corps, erreur } = this.lirePolitique();
    if (erreur || !corps) {
      if (errEl) { errEl.textContent = erreur || ''; errEl.classList.add('show'); }
      return;
    }
    const btn = document.getElementById('btn-politique-save') as HTMLButtonElement | null;
    if (btn) { btn.disabled = true; btn.textContent = 'Enregistrement…'; }
    try {
      await Api.put('/securite/politique', corps);
      toast('Politique de sécurité enregistrée ✓', 's');
    } catch (e: any) {
      if (errEl) { errEl.textContent = e.message || 'Enregistrement impossible'; errEl.classList.add('show'); }
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Enregistrer'; }
    }
  },

  init: function() { this.charger(); this.chargerPolitique(); PagePlages.charger(); PageSms.charger(); }
};

(window as any).PageParametres = PageParametres;
PAGE_HOOKS['parametres'] = () => PageParametres.init();
