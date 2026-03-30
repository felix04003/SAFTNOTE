'use strict';

// ── Utilitaires date ─────────────────────────────────────────────
// Pas de toISOString() : décalage UTC possible sur les fuseaux UTC+X

function _lundiDeSemaine(date) {
  var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  var jour = d.getDay(); // 0=dim, 1=lun, …, 6=sam
  var diff = (jour === 0) ? -6 : 1 - jour;
  d.setDate(d.getDate() + diff);
  return d;
}

function _dateISO(d) {
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var jj = ('0' + d.getDate()).slice(-2);
  return d.getFullYear() + '-' + mm + '-' + jj;
}

function _addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function _labelSemaine(lundi) {
  var ven = _addDays(lundi, 4);
  var mois = ['jan','fév','mars','avr','mai','juin','juil','août','sep','oct','nov','déc'];
  return 'Lun ' + lundi.getDate() + ' ' + mois[lundi.getMonth()] +
    ' \u2013 Ven ' + ven.getDate() + ' ' + mois[ven.getMonth()] +
    ' ' + ven.getFullYear();
}

// ═════════════════════════════════════════════════════════════════
// PageEnsEdt — navigation semaine + rendu grille
// ═════════════════════════════════════════════════════════════════

var PageEnsEdt = {
  _semaine:     null, // Date (lundi de la semaine affichée)
  _data:        null, // Dernière réponse API
  _creneauxMap: {},   // creneau_id → objet creneau (évite JSON.stringify dans onclick)

  init: function() {
    PageEnsEdt._semaine = _lundiDeSemaine(new Date());
    PageEnsEdt._charger();
  },

  semainePrec: function() {
    PageEnsEdt._semaine = _addDays(PageEnsEdt._semaine, -7);
    PageEnsEdt._charger();
  },

  semaineSuiv: function() {
    PageEnsEdt._semaine = _addDays(PageEnsEdt._semaine, 7);
    PageEnsEdt._charger();
  },

  semaineAuj: function() {
    PageEnsEdt._semaine = _lundiDeSemaine(new Date());
    PageEnsEdt._charger();
  },

  _charger: async function() {
    var label = document.getElementById('edt-label-semaine');
    if (label) label.textContent = _labelSemaine(PageEnsEdt._semaine);

    try {
      var res = await Api.get('/enseignants/moi/edt', { semaine: _dateISO(PageEnsEdt._semaine) });
      PageEnsEdt._data = res.data;

      var anneeEl = document.getElementById('ens-edt-annee');
      if (anneeEl && res.data.annee) anneeEl.textContent = res.data.annee;

      PageEnsEdt._renderGrid(res.data);
    } catch (e) {
      console.warn('PageEnsEdt: chargement échoué —', e.message);
      var grid = document.getElementById('ens-edt-grid');
      if (grid) grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gris);font-size:13px">Emploi du temps indisponible</div>';
    }
  },

  _renderGrid: function(data) {
    var grid = document.getElementById('ens-edt-grid');
    if (!grid || !data || !data.emploi_du_temps) return;

    PageEnsEdt._creneauxMap = {};

    var jours = data.emploi_du_temps; // [{jour, nom, creneaux:[…]}]

    if (jours.length === 0) {
      grid.innerHTML = '<div style="text-align:center;padding:40px;color:var(--gris);font-size:13px">Aucun créneau cette semaine</div>';
      return;
    }

    // Collecter toutes les plages uniques, triées par numéro
    var plagesMap = {};
    jours.forEach(function(j) {
      (j.creneaux || []).forEach(function(c) {
        if (!plagesMap[c.heure_debut]) {
          plagesMap[c.heure_debut] = {
            debut:  c.heure_debut,
            fin:    c.heure_fin,
            numero: c.plage_numero,
          };
        }
        // Indexer dans _creneauxMap
        if (c.creneau_id) PageEnsEdt._creneauxMap[c.creneau_id] = c;
      });
    });

    var plages = Object.values(plagesMap).sort(function(a, b) {
      return a.numero - b.numero;
    });

    // Indexer les créneaux par [jour][heure_debut]
    var creneauxIdx = {};
    jours.forEach(function(j) {
      creneauxIdx[j.jour] = {};
      (j.creneaux || []).forEach(function(c) {
        creneauxIdx[j.jour][c.heure_debut] = c;
      });
    });

    // Construire le HTML en une passe (pas de += dans la boucle)
    var parts = [];
    parts.push('<div class="edt-grid" style="grid-template-columns:60px repeat(' + jours.length + ',1fr)">');

    // En-têtes jours
    parts.push('<div class="edt-h"></div>');
    jours.forEach(function(j) {
      parts.push('<div class="edt-h">' + j.nom + '</div>');
    });

    // Lignes par plage horaire
    plages.forEach(function(plage) {
      parts.push('<div class="edt-t">' + plage.debut + '</div>');

      jours.forEach(function(j) {
        var c = creneauxIdx[j.jour] && creneauxIdx[j.jour][plage.debut];

        if (!c) {
          parts.push('<div class="edt-slot vide"></div>');
          return;
        }

        if (c.est_pause) {
          parts.push('<div class="edt-slot vide"><span class="edt-creneau-pause">\u2014</span></div>');
          return;
        }

        // Créneau de cours : cliquable
        var couleur = c.couleur_affichage || '#1a4731';
        // Calculer la date ISO du jour (lundi + offset jour_semaine-1)
        var dateISO = _dateISO(_addDays(PageEnsEdt._semaine, j.jour - 1));

        parts.push(
          '<div class="edt-creneau" style="background:' + couleur + '" ' +
          'onclick="EdtDrawer.ouvrir(\'' + c.creneau_id + '\',\'' + dateISO + '\')">' +
          '<div class="edt-creneau-mat">' + (c.matiere || '') + '</div>' +
          '<div class="edt-creneau-info">' + (c.classe || '') + (c.salle ? ' \xb7 ' + c.salle : '') + '</div>' +
          '</div>'
        );
      });
    });

    parts.push('</div>');
    grid.innerHTML = parts.join('');
  },
};

// ═════════════════════════════════════════════════════════════════
// EdtDrawer — gestion du panneau latéral
// ═════════════════════════════════════════════════════════════════

var EdtDrawer = {
  _creneau:  null,   // objet creneau courant (depuis _creneauxMap)
  _dateISO:  null,   // date du cours YYYY-MM-DD
  _eleves:   [],     // tableau élèves chargé depuis GET /appels/cours
  _appel_id: null,
  _statut:   null,   // 'ouvert' | 'effectue' | null
  _onglet:   'appel',

  ouvrir: async function(creneauId, dateISO) {
    var creneau = PageEnsEdt._creneauxMap[creneauId];
    if (!creneau) return;

    EdtDrawer._creneau  = creneau;
    EdtDrawer._dateISO  = dateISO;
    EdtDrawer._appel_id = null;
    EdtDrawer._statut   = null;
    EdtDrawer._eleves   = [];
    EdtDrawer._onglet   = 'appel';

    // Mettre à jour l'en-tête (couleur matière)
    var couleur = creneau.couleur_affichage || '#1a4731';
    var header = document.getElementById('edt-drawer-header');
    if (header) header.style.background = couleur;

    var matEl = document.getElementById('edt-drawer-matiere');
    if (matEl) matEl.textContent = creneau.matiere || '';

    var infoEl = document.getElementById('edt-drawer-info');
    if (infoEl) {
      infoEl.textContent = (creneau.classe || '') +
        ' \xb7 ' + (creneau.heure_debut || '') + '\u2013' + (creneau.heure_fin || '') +
        (creneau.salle ? ' \xb7 ' + creneau.salle : '');
    }

    // Afficher drawer + overlay
    var overlay = document.getElementById('edt-overlay');
    var drawer  = document.getElementById('edt-drawer');
    if (overlay) overlay.classList.add('show');
    if (drawer)  drawer.classList.add('open');

    // Charger données appel puis afficher l'onglet
    var ok = await EdtDrawer._chargerDonnees();
    if (ok) EdtDrawer.onglet(EdtDrawer._onglet);
  },

  fermer: function() {
    var overlay = document.getElementById('edt-overlay');
    var drawer  = document.getElementById('edt-drawer');
    if (overlay) overlay.classList.remove('show');
    if (drawer)  drawer.classList.remove('open');
  },

  _chargerDonnees: async function() {
    var body = document.getElementById('edt-drawer-body');
    if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--gris)">Chargement\u2026</div>';

    try {
      var res = await Api.get('/appels/cours', {
        emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
        date_cours:         EdtDrawer._dateISO,
      });
      EdtDrawer._appel_id = res.data.appel_id;
      EdtDrawer._statut   = res.data.statut;
      EdtDrawer._eleves   = res.data.eleves || [];
      return true;
    } catch (e) {
      var body2 = document.getElementById('edt-drawer-body');
      if (body2) {
        body2.innerHTML = '<div style="color:var(--rouge);padding:16px">Erreur\u00a0: ' + (e.message || 'Chargement échoué') + '</div>';
      }
      return false;
    }
  },

  onglet: function(nom) {
    EdtDrawer._onglet = nom;

    // Mettre à jour les boutons onglets
    var tabs = ['appel', 'historique', 'notes', 'salle'];
    tabs.forEach(function(t) {
      var btn = document.getElementById('edt-tab-' + t);
      if (btn) btn.className = 'edt-tab' + (t === nom ? ' active' : '');
    });

    var body = document.getElementById('edt-drawer-body');
    if (!body) return;

    if (nom === 'appel')           EdtAppel.render(body);
    else if (nom === 'historique') EdtDrawer._renderHistorique(body);
    else if (nom === 'notes')      EdtDrawer._renderNotes(body);
    else if (nom === 'salle')      EdtDrawer._renderSalle(body);
  },

  _renderHistorique: function(body) {
    var parts = [];

    if (EdtDrawer._statut === 'ouvert') {
      parts.push('<div style="background:#fef3e2;color:#b7670a;padding:10px 12px;border-radius:var(--rs);margin-bottom:12px;font-size:13px">Appel en cours \u2014 données partielles</div>');
    }

    if (EdtDrawer._eleves.length === 0) {
      body.innerHTML = '<div style="color:var(--gris);padding:16px">Aucun élève</div>';
      return;
    }

    function badge(el) {
      var s = el.statut;
      if (s === 'present')     return '<span class="badge-present">\u2713 Présent</span>';
      if (s === 'absent')      return '<span class="badge-absent">\u2717 Absent</span>';
      if (s === 'retard')      return '<span class="badge-retard">\u23f1 Retard' + (el.minutes_retard ? ' (' + el.minutes_retard + 'min)' : '') + '</span>';
      if (s === 'sorti_avant') return '<span class="badge-sorti">Sorti tôt</span>';
      if (s === 'dispense')    return '<span class="badge-dispense">Dispensé</span>';
      return '<span class="badge-nonsaisi">\u2014</span>';
    }

    EdtDrawer._eleves.forEach(function(el) {
      parts.push(
        '<div class="edt-eleve-row">' +
          '<span class="edt-eleve-nom">' + el.nom + ' ' + el.prenom + '</span>' +
          badge(el) +
        '</div>'
      );
    });

    body.innerHTML = parts.join('');
  },

  _renderNotes: function(body) {
    var c = EdtDrawer._creneau;
    body.innerHTML =
      '<div style="padding:8px 0">' +
        '<button class="btn btn-p" onclick="' +
          'if(window.PageEnsNotes&&PageEnsNotes.prefiltrer){' +
            'PageEnsNotes.prefiltrer(\'' + (c.classe_id || '') + '\',\'' + (c.affectation_id || '') + '\');' +
          '}goto(\'ens-notes\');EdtDrawer.fermer()">' +
          '\u2192 Ajouter une évaluation' +
        '</button>' +
      '</div>';
  },

  _renderSalle: function(body) {
    var salle = (EdtDrawer._creneau && EdtDrawer._creneau.salle) || '';
    body.innerHTML =
      '<div style="margin-bottom:12px;font-size:13px;color:var(--gris)">Salle actuelle\u00a0: <strong>' + (salle || '\u2014') + '</strong></div>' +
      '<input id="edt-salle-input" class="fi" type="text" maxlength="50" placeholder="Ex: Salle 12, Amphi A\u2026" value="' + salle + '" style="width:100%;box-sizing:border-box;margin-bottom:12px">' +
      '<button class="btn btn-p" style="width:100%" onclick="EdtDrawer._saveSalle()">Enregistrer</button>' +
      '<div id="edt-salle-msg" style="margin-top:10px;font-size:13px"></div>';
  },

  _saveSalle: async function() {
    var input = document.getElementById('edt-salle-input');
    var msg   = document.getElementById('edt-salle-msg');
    if (!input || !EdtDrawer._creneau) return;

    var salle = input.value.trim();
    try {
      await Api.put('/enseignants/moi/edt/' + EdtDrawer._creneau.creneau_id + '/salle', { salle: salle || null });
      EdtDrawer._creneau.salle = salle;

      if (msg) { msg.style.color = 'var(--vert)'; msg.textContent = '\u2713 Salle mise à jour'; }

      // Mise à jour visuelle de l'en-tête du drawer
      var infoEl = document.getElementById('edt-drawer-info');
      if (infoEl) {
        infoEl.textContent = (EdtDrawer._creneau.classe || '') +
          ' \xb7 ' + (EdtDrawer._creneau.heure_debut || '') + '\u2013' + (EdtDrawer._creneau.heure_fin || '') +
          (salle ? ' \xb7 ' + salle : '');
      }

      // Redessiner la grille (mise à jour locale — cache Redis invalidé côté serveur)
      if (PageEnsEdt._data) PageEnsEdt._renderGrid(PageEnsEdt._data);

    } catch (e) {
      if (msg) { msg.style.color = 'var(--rouge)'; msg.textContent = 'Erreur\u00a0: ' + (e.message || 'Mise à jour échouée'); }
    }
  },
};

// ═════════════════════════════════════════════════════════════════
// EdtAppel — logique de saisie et soumission de l'appel
// ═════════════════════════════════════════════════════════════════

var EdtAppel = {
  _statutsLocaux: {}, // inscription_id → { statut: string|null, minutes_retard: number }

  render: function(body) {
    EdtAppel._statutsLocaux = {};

    if (EdtDrawer._statut === 'effectue') {
      EdtAppel._renderCloture(body);
      return;
    }

    // Initialiser depuis les données existantes (appel ouvert ou null)
    EdtDrawer._eleves.forEach(function(el) {
      EdtAppel._statutsLocaux[el.inscription_id] = {
        statut:         el.statut !== 'non_saisi' ? el.statut : null,
        minutes_retard: el.minutes_retard || 0,
      };
    });

    EdtAppel._renderSaisie(body);
  },

  _renderCloture: function(body) {
    var nb_p = EdtDrawer._eleves.filter(function(e) { return e.statut === 'present'; }).length;
    var nb_a = EdtDrawer._eleves.filter(function(e) { return e.statut === 'absent'; }).length;
    var nb_r = EdtDrawer._eleves.filter(function(e) { return e.statut === 'retard'; }).length;

    body.innerHTML =
      '<div style="background:var(--bg);border-radius:var(--rs);padding:16px;margin-bottom:16px">' +
        '<div style="font-weight:700;margin-bottom:8px">Appel clôturé</div>' +
        '<div style="font-size:13px;color:var(--gris)">' +
          nb_p + ' présents \xb7 ' + nb_a + ' absents \xb7 ' + nb_r + ' retards' +
        '</div>' +
      '</div>' +
      '<button class="btn btn-s" onclick="EdtDrawer.onglet(\'historique\')">Voir le détail</button>';
  },

  _renderSaisie: function(body) {
    var nb_saisis = Object.values(EdtAppel._statutsLocaux).filter(function(s) { return s.statut !== null; }).length;
    var total     = EdtDrawer._eleves.length;
    var tousOk    = (nb_saisis === total && total > 0);

    var parts = [];
    parts.push('<div class="edt-badge-saisis">' + nb_saisis + '/' + total + ' saisis</div>');

    EdtDrawer._eleves.forEach(function(el) {
      var id = el.inscription_id;
      var s  = EdtAppel._statutsLocaux[id] || { statut: null, minutes_retard: 0 };

      parts.push(
        '<div class="edt-eleve-row" id="row-' + id + '">' +
          '<span class="edt-eleve-nom">' + el.nom + ' ' + el.prenom + '</span>' +
          '<div class="edt-eleve-btns">' +
            '<button class="btn btn-xs edt-btn-present' + (s.statut === 'present' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'present\')">\u2713</button>' +
            '<button class="btn btn-xs edt-btn-absent' + (s.statut === 'absent' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'absent\')">\u2717</button>' +
            '<button class="btn btn-xs edt-btn-retard' + (s.statut === 'retard' ? ' actif' : '') + '" ' +
              'onclick="EdtAppel.setStatut(\'' + id + '\',\'retard\')">\u23f1</button>' +
          '</div>' +
        '</div>' +
        '<div id="retard-' + id + '" style="display:' + (s.statut === 'retard' ? 'block' : 'none') + ';padding:4px 0 8px 0">' +
          '<input class="edt-retard-input" type="number" min="1" max="120" placeholder="min" value="' + (s.minutes_retard || '') + '" ' +
            'oninput="EdtAppel.setRetard(\'' + id + '\',this.value)">' +
        '</div>'
      );
    });

    parts.push(
      '<button class="btn btn-p edt-cloture-btn" id="edt-btn-cloture"' +
        (tousOk ? '' : ' disabled') +
        ' onclick="EdtAppel.soumettre()">Clôturer l\'appel</button>'
    );

    body.innerHTML = parts.join('');
  },

  setStatut: function(inscriptionId, statut) {
    if (!EdtAppel._statutsLocaux[inscriptionId]) {
      EdtAppel._statutsLocaux[inscriptionId] = { statut: null, minutes_retard: 0 };
    }
    EdtAppel._statutsLocaux[inscriptionId].statut = statut;

    // Mettre à jour classes actif sur les boutons
    var row = document.getElementById('row-' + inscriptionId);
    if (row) {
      ['present', 'absent', 'retard'].forEach(function(s) {
        var btn = row.querySelector('.edt-btn-' + s);
        if (!btn) return;
        var cls = btn.className.replace(' actif', '');
        btn.className = cls + (s === statut ? ' actif' : '');
      });
    }

    // Afficher / masquer le champ minutes de retard
    var retardDiv = document.getElementById('retard-' + inscriptionId);
    if (retardDiv) retardDiv.style.display = (statut === 'retard') ? 'block' : 'none';

    EdtAppel._majBadge();
  },

  setRetard: function(inscriptionId, val) {
    if (EdtAppel._statutsLocaux[inscriptionId]) {
      EdtAppel._statutsLocaux[inscriptionId].minutes_retard = parseInt(val) || 0;
    }
  },

  _majBadge: function() {
    var nb_saisis = Object.values(EdtAppel._statutsLocaux).filter(function(s) { return s.statut !== null; }).length;
    var total     = EdtDrawer._eleves.length;

    var badge = document.querySelector('.edt-badge-saisis');
    if (badge) badge.textContent = nb_saisis + '/' + total + ' saisis';

    var btnCloture = document.getElementById('edt-btn-cloture');
    if (btnCloture) btnCloture.disabled = (nb_saisis < total || total === 0);
  },

  soumettre: async function() {
    var btnCloture = document.getElementById('edt-btn-cloture');
    if (btnCloture) { btnCloture.disabled = true; btnCloture.textContent = 'Envoi\u2026'; }

    try {
      // Étape 1 : créer l'appel s'il n'existe pas encore
      if (!EdtDrawer._appel_id) {
        var postRes = await Api.post('/appels', {
          emploi_du_temps_id: EdtDrawer._creneau.creneau_id,
          date_cours:         EdtDrawer._dateISO,
        });
        EdtDrawer._appel_id = postRes.data.appel_id;
      }

      // Étape 2 : soumettre toutes les présences
      var presences = EdtDrawer._eleves.map(function(el) {
        var s = EdtAppel._statutsLocaux[el.inscription_id] || { statut: 'present', minutes_retard: 0 };
        var item = {
          inscription_id: el.inscription_id,
          statut:         s.statut || 'present',
        };
        if (s.statut === 'retard' && s.minutes_retard > 0) {
          item.minutes_retard = s.minutes_retard;
        }
        return item;
      });

      await Api.put('/appels/' + EdtDrawer._appel_id + '/presences', {
        presences: presences,
        cloturer:  true,
      });

      // Succès : mettre à jour l'état local
      EdtDrawer._statut = 'effectue';
      EdtDrawer._eleves.forEach(function(el) {
        var s = EdtAppel._statutsLocaux[el.inscription_id];
        if (s) {
          el.statut         = s.statut || 'present';
          el.minutes_retard = s.minutes_retard || 0;
        }
      });

      var body = document.getElementById('edt-drawer-body');
      if (body) EdtAppel._renderCloture(body);

    } catch (e) {
      if (btnCloture) {
        btnCloture.disabled  = false;
        btnCloture.textContent = 'Clôturer l\'appel';
      }

      // Afficher l'erreur inline sous le bouton
      var msgEl = document.getElementById('edt-appel-err');
      if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'edt-appel-err';
        msgEl.style.cssText = 'color:var(--rouge);font-size:13px;margin-top:8px';
        var body2 = document.getElementById('edt-drawer-body');
        if (body2) body2.appendChild(msgEl);
      }
      msgEl.textContent = 'Erreur\u00a0: ' + (e.message || 'Soumission échouée');

      // Si l'appel a été clôturé entre temps, recharger l'état
      if (e.status === 404 || e.status === 409) {
        var ok = await EdtDrawer._chargerDonnees();
        if (ok) {
          var body3 = document.getElementById('edt-drawer-body');
          if (body3) EdtAppel.render(body3);
        }
      }
    }
  },
};

PAGE_HOOKS['ens-edt'] = function() { PageEnsEdt.init(); };
