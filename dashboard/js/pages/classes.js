'use strict';

/**
 * Page Classes — liste + création d'une nouvelle classe.
 */
var PageClasses = {
  data: [],
  _niveaux: [],   // cache des niveaux pour le modal

  async charger() {
    try {
      var res = await Api.get('/classes');
      var classes = res.data || [];
      this.data = classes;
      this.renderGrid(classes);
      this.peuplerDropdowns(classes);
      var sous = document.getElementById('ph-sous-classes');
      if (sous) sous.textContent = classes.length + ' classe' + (classes.length > 1 ? 's' : '') + ' · Année en cours';
      return true;
    } catch (e) {
      console.warn('PageClasses: fallback mock —', e.message);
      return false;
    }
  },

  peuplerDropdowns: function(classes) {
    // Peupler tous les selects de filtre par classe dans l'application
    var selects = [
      document.getElementById('sel-classe-eleves'),
      document.getElementById('sel-classe-edt'),
      document.getElementById('m-eleve-classe'),
    ];
    selects.forEach(function(sel) {
      if (!sel) return;
      var valActuelle = sel.value;
      // Conserver uniquement la 1re option (Toutes classes / Choisir...)
      while (sel.options.length > 1) sel.remove(1);
      classes.forEach(function(c) {
        var opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.nom_classe || c.nom || c.id;
        sel.appendChild(opt);
      });
      if (valActuelle) sel.value = valActuelle;
    });
  },

  async chargerNiveaux() {
    if (this._niveaux.length) return;
    try {
      var res = await Api.get('/niveaux');
      this._niveaux = res.data || [];
      var sel = document.getElementById('m-classe-niveau');
      if (!sel) return;
      sel.innerHTML = '<option value="">— Choisir un niveau —</option>' +
        this._niveaux.map(function(n) {
          return '<option value="' + escapeHtml(String(n.id || '')) + '">' + escapeHtml(n.nom || '') + '</option>';
        }).join('');
    } catch (e) {
      console.warn('PageClasses.chargerNiveaux —', e.message);
    }
  },

  ouvrirModal: function() {
    this.chargerNiveaux();
    openModal('m-classe');
  },

  async creer() {
    var niveauId  = document.getElementById('m-classe-niveau')?.value;
    var nom       = document.getElementById('m-classe-nom')?.value?.trim().toUpperCase();
    var salle     = document.getElementById('m-classe-salle')?.value?.trim();
    var effectif  = parseInt(document.getElementById('m-classe-effectif')?.value) || undefined;

    if (!niveauId) return toast('Choisissez un niveau', 'w');
    if (!nom)      return toast('La lettre de classe est obligatoire', 'w');

    var payload = {
      niveau_id:        niveauId,
      nom:              nom,
      salle_principale: salle || undefined,
      effectif_max:     effectif,
    };

    var btn = document.getElementById('btn-creer-classe');
    if (btn) { btn.disabled = true; btn.textContent = 'Création…'; }

    try {
      var res = await Api.post('/classes', payload);
      closeModal('m-classe');
      var label = (res.data && (res.data.niveau + ' ' + res.data.nom)) || nom;
      toast('Classe ' + label + ' créée ✓', 's');
      this._niveaux = []; // reset cache pour forcer rechargement si besoin
      await this.charger();
    } catch (e) {
      toast('Erreur : ' + (e.message || 'Création échouée'), 'd');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Créer la classe'; }
    }
  },

  renderGrid: function(classes) {
    var grid = document.getElementById('cls-grid');
    if (!grid) return;

    if (!classes.length) {
      grid.innerHTML = '<div style="text-align:center;color:var(--g400);padding:40px;grid-column:1/-1">Aucune classe — cliquez sur "+ Nouvelle classe" pour en créer une</div>';
      return;
    }

    grid.innerHTML = classes.map(function(c) {
      var nom      = escapeHtml(c.nom_classe || c.nom || '—');
      var effectif = c.effectif || c.effectif_max || 0;
      var moy      = c.moyenne != null ? c.moyenne : null;
      var pres     = c.taux_presence != null ? c.taux_presence : null;
      var salle    = escapeHtml(c.salle_principale || '');

      return '<div class="carte" style="cursor:pointer;transition:transform .15s" onmouseenter="this.style.transform=\'translateY(-3px)\'" onmouseleave="this.style.transform=\'\'">' +
        '<div style="padding:16px 18px">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:11px">' +
            '<div><div style="font-size:17px;font-weight:800">' + nom + '</div>' +
            '<div style="font-size:11.5px;color:var(--g400);margin-top:2px">' + salle + (effectif ? ' · ' + effectif + ' élèves' : '') + '</div></div>' +
            (moy != null ? '<div class="nb" style="color:' + cn(moy) + ';font-size:12px;width:38px;height:38px">' + moy + '</div>' : '') +
          '</div>' +
          (pres != null ?
            '<div style="display:flex;justify-content:space-between;font-size:11.5px;margin-bottom:3px">' +
              '<span style="color:var(--g500)">Présence</span>' +
              '<span style="font-weight:700;color:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '">' + pres + '%</span>' +
            '</div>' +
            '<div class="pb"><div class="pf" style="width:' + pres + '%;--c:' + (pres >= 92 ? 'var(--success)' : pres >= 85 ? 'var(--warning)' : 'var(--rouge)') + '"></div></div>' : '') +
          '<div style="display:flex;gap:6px;margin-top:12px">' +
            '<button class="btn btn-l btn-sm" style="flex:1" onclick="PageClasses.voirClasse(\'' + c.id + '\')">Voir</button>' +
            '<button class="btn btn-l btn-sm" onclick="goto(\'edt\')">📅</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  voirClasse: async function(id) {
    var classe = this.data.find(function(c) { return c.id === id; });
    var nom = classe ? (classe.nom_classe || classe.nom || 'Classe') : 'Classe';

    // Remplir le titre et les stats de base
    document.getElementById('m-detail-classe-titre').textContent = nom;
    document.getElementById('dc-salle').textContent = (classe && classe.salle_principale) || '—';
    document.getElementById('dc-nb-eleves').textContent = '…';
    document.getElementById('dc-nb-matieres').textContent = '…';
    document.getElementById('dc-affectations').innerHTML = '<span style="color:var(--g400);font-size:13px">Chargement…</span>';
    document.getElementById('dc-eleves').innerHTML = '<span style="color:var(--g400);font-size:13px">Chargement…</span>';

    openModal('m-detail-classe');

    // Charger élèves et affectations en parallèle
    try {
      var results = await Promise.all([
        Api.get('/classes/' + id + '/eleves'),
        Api.get('/classes/' + id + '/affectations'),
      ]);
      var eleves      = results[0].data || [];
      var affectations = results[1].data || [];

      // Stats
      document.getElementById('dc-nb-eleves').textContent  = eleves.length;
      document.getElementById('dc-nb-matieres').textContent = affectations.length;

      // Affectations
      var affDiv = document.getElementById('dc-affectations');
      if (!affectations.length) {
        affDiv.innerHTML = '<span style="color:var(--g400);font-size:13px">Aucun enseignant affecté</span>';
      } else {
        affDiv.innerHTML = affectations.map(function(a) {
          return '<span style="display:inline-flex;align-items:center;gap:5px;background:var(--g100);border-radius:20px;padding:4px 10px;font-size:12px">' +
            '<span style="width:8px;height:8px;border-radius:50%;background:' + escapeHtml(a.couleur_affichage || 'var(--vert)') + ';display:inline-block"></span>' +
            '<b>' + escapeHtml(a.matiere || '—') + '</b>' +
            '<span style="color:var(--g500)">— ' + escapeHtml((a.enseignant_prenom || '') + ' ' + (a.enseignant_nom || '')) + '</span>' +
          '</span>';
        }).join('');
      }

      // Liste élèves
      var elvDiv = document.getElementById('dc-eleves');
      if (!eleves.length) {
        elvDiv.innerHTML = '<div style="text-align:center;color:var(--g400);padding:20px">Aucun élève inscrit dans cette classe</div>';
      } else {
        elvDiv.innerHTML = '<table style="width:100%;border-collapse:collapse;font-size:13px">' +
          '<thead><tr style="border-bottom:1px solid var(--g200)">' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">#</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Nom</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Prénom</th>' +
            '<th style="text-align:left;padding:6px 8px;font-weight:600;color:var(--g600)">Matricule</th>' +
          '</tr></thead>' +
          '<tbody>' +
          eleves.map(function(e, i) {
            return '<tr style="border-bottom:1px solid var(--g100)">' +
              '<td style="padding:7px 8px;color:var(--g400)">' + (i + 1) + '</td>' +
              '<td style="padding:7px 8px;font-weight:600">' + escapeHtml(e.nom || '—') + '</td>' +
              '<td style="padding:7px 8px">' + escapeHtml(e.prenom || '—') + '</td>' +
              '<td style="padding:7px 8px;font-family:monospace;font-size:11px;color:var(--g500)">' + escapeHtml(e.matricule || '—') + '</td>' +
            '</tr>';
          }).join('') +
          '</tbody></table>';
      }
    } catch (err) {
      document.getElementById('dc-eleves').innerHTML = '<span style="color:var(--rouge);font-size:13px">Erreur : ' + escapeHtml(err.message || '') + '</span>';
    }
  },
  init: function() { this.charger(); }
};

PAGE_HOOKS.classes = function() { PageClasses.init(); };
