'use strict';

/* ── Notifs — module notifications in-app ──────────────────────
 * Partagé entre les 3 portails (index.html, enseignant.html, parent.html)
 * Polling toutes les 60s. Drawer latéral.
 * ES5 strict — pas d'arrow functions, pas de const/let.
 * ─────────────────────────────────────────────────────────────── */

var Notifs = {
  _timer:   null,
  _data:    null,
  _ouvert:  false,

  // ── Labels par type ────────────────────────────────────────
  _labels: {
    appels_manques:        { icone: '⚠️',  label: 'Appels non effectués'  },
    absences_injustifiees: { icone: '🚨',  label: 'Absences injustifiées' },
    notes_publiees:        { icone: '📝',  label: 'Notes publiées'        },
    bulletins_disponibles: { icone: '📄',  label: 'Bulletins disponibles' },
    incidents_discipline:  { icone: '🔴',  label: 'Incidents discipl.'    },
  },

  // ── Init : appelé une fois au chargement de la page ────────
  init: function() {
    Notifs._charger();
    Notifs._timer = setInterval(Notifs._charger, 60000);

    // Fermer le drawer avec Échap
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && Notifs._ouvert) Notifs.fermer();
    });
  },

  // ── Chargement depuis l'API ────────────────────────────────
  _charger: function() {
    Api.get('/notifications').then(function(res) {
      Notifs._data = res.data;
      Notifs._updateBadge(res.data.total);
      // Si drawer ouvert, rafraîchir le contenu
      if (Notifs._ouvert) Notifs._renderDrawer();
    }).catch(function() {
      // Silencieux — pas de notification si offline
    });
  },

  // ── Badge ──────────────────────────────────────────────────
  _updateBadge: function(count) {
    var badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    if (count > 0) {
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  },

  // ── Toggle drawer ──────────────────────────────────────────
  toggle: function() {
    if (Notifs._ouvert) {
      Notifs.fermer();
    } else {
      Notifs.ouvrir();
    }
  },

  ouvrir: function() {
    var drawer  = document.getElementById('notif-drawer');
    var overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    Notifs._renderDrawer();
    drawer.classList.add('open');
    overlay.classList.add('show');
    Notifs._ouvert = true;
  },

  fermer: function() {
    var drawer  = document.getElementById('notif-drawer');
    var overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    drawer.classList.remove('open');
    overlay.classList.remove('show');
    Notifs._ouvert = false;
  },

  // ── Rendu du contenu du drawer ─────────────────────────────
  _renderDrawer: function() {
    var body = document.getElementById('notif-drawer-body');
    if (!body) return;

    if (!Notifs._data) {
      body.innerHTML = '<div class="notif-empty">Chargement…</div>';
      return;
    }

    var categories = Notifs._data.categories;
    var nonVides   = categories.filter(function(c) { return c.count > 0; });

    if (!nonVides.length) {
      body.innerHTML = '<div class="notif-empty">✅ Tout est en ordre — aucune alerte</div>';
      return;
    }

    var parts = [];
    nonVides.forEach(function(cat) {
      var meta = Notifs._labels[cat.type] || { icone: '•', label: cat.label };
      parts.push('<div class="notif-section">');
      parts.push(
        '<div class="notif-section-header">' +
        meta.icone + ' ' + meta.label +
        ' <span class="notif-count">' + cat.count + '</span>' +
        '</div>'
      );
      cat.items.forEach(function(item) {
        parts.push('<div class="notif-item">');
        parts.push(Notifs._renderItem(cat.type, item));
        parts.push('</div>');
      });
      parts.push('</div>');
    });

    body.innerHTML = parts.join('');
  },

  // ── Rendu d'un item selon le type ─────────────────────────
  _renderItem: function(type, item) {
    switch (type) {
      case 'appels_manques':
        return '<strong>' + escapeHtml(item.matiere || '—') + '</strong> · ' + escapeHtml(item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + (item.heure ? ' · ' + escapeHtml(item.heure) : '') + '</div>';

      case 'absences_injustifiees':
        return '<strong>' + escapeHtml(item.eleve || '—') + '</strong> · ' + escapeHtml(item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + '</div>';

      case 'notes_publiees':
        return '<strong>' + escapeHtml(item.matiere || '—') + '</strong> · ' + escapeHtml(item.classe || '') +
               '<div class="notif-meta">' + Notifs._fmtDate(item.date) + '</div>';

      case 'bulletins_disponibles':
        return '<strong>' + escapeHtml(item.eleve || item.periode || '—') + '</strong>' +
               '<div class="notif-meta">' + escapeHtml(item.periode || '') + ' · ' + Notifs._fmtDate(item.date) + '</div>';

      case 'incidents_discipline':
        return '<strong>' + escapeHtml(item.eleve || '—') + '</strong> · ' +
               '<span style="color:var(--rouge)">' + escapeHtml(item.gravite || '') + '</span>' +
               '<div class="notif-meta">' + escapeHtml(item.type || '') + ' · ' + Notifs._fmtDate(item.date) + '</div>';

      default:
        return JSON.stringify(item);
    }
  },

  // ── Formatage date DD/MM ───────────────────────────────────
  _fmtDate: function(dateStr) {
    if (!dateStr) return '';
    var d = new Date(dateStr);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  },
};
