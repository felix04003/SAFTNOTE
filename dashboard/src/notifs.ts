import { Api } from './api';
import { escapeHtml } from './ui';

export const Notifs = {
  _timer: null as any,
  _data:  null as any,
  _ouvert: false,

  _labels: {
    appels_manques:        { icone: '⚠️',  label: 'Appels non effectués'  },
    absences_injustifiees: { icone: '🚨',  label: 'Absences injustifiées' },
    notes_publiees:        { icone: '📝',  label: 'Notes publiées'        },
    bulletins_disponibles: { icone: '📄',  label: 'Bulletins disponibles' },
    incidents_discipline:  { icone: '🔴',  label: 'Incidents discipl.'    },
  } as Record<string, { icone: string; label: string }>,

  init() {
    Notifs._charger();
    Notifs._timer = setInterval(Notifs._charger, 60000);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && Notifs._ouvert) Notifs.fermer();
    });
  },

  _charger() {
    Api.get('/notifications').then((res) => {
      Notifs._data = res.data;
      Notifs._updateBadge(res.data.total);
      if (Notifs._ouvert) Notifs._renderDrawer();
    }).catch(() => {});
  },

  _updateBadge(count: number) {
    const badge = document.getElementById('notif-badge');
    if (!badge) return;
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.classList.toggle('show', count > 0);
  },

  toggle() { Notifs._ouvert ? Notifs.fermer() : Notifs.ouvrir(); },

  ouvrir() {
    const drawer  = document.getElementById('notif-drawer');
    const overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    Notifs._renderDrawer();
    drawer.classList.add('open');
    if (overlay) overlay.classList.add('show');
    Notifs._ouvert = true;
  },

  fermer() {
    const drawer  = document.getElementById('notif-drawer');
    const overlay = document.getElementById('notif-overlay');
    if (!drawer) return;
    drawer.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    Notifs._ouvert = false;
  },

  _renderDrawer() {
    const body = document.getElementById('notif-drawer-body');
    if (!body) return;
    if (!Notifs._data) { body.innerHTML = '<div class="notif-empty">Chargement…</div>'; return; }
    const nonVides = (Notifs._data.categories || []).filter((c: any) => c.count > 0);
    if (!nonVides.length) {
      body.innerHTML = '<div class="notif-empty">✅ Tout est en ordre — aucune alerte</div>';
      return;
    }
    const parts: string[] = [];
    nonVides.forEach((cat: any) => {
      const meta = Notifs._labels[cat.type] || { icone: '•', label: cat.label };
      parts.push(
        '<div class="notif-section">' +
        '<div class="notif-section-header">' + meta.icone + ' ' + meta.label +
        ' <span class="notif-count">' + cat.count + '</span></div>'
      );
      cat.items.forEach((item: any) => {
        parts.push('<div class="notif-item">' + Notifs._renderItem(cat.type, item) + '</div>');
      });
      parts.push('</div>');
    });
    body.innerHTML = parts.join('');
  },

  _renderItem(type: string, item: any): string {
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

  _fmtDate(dateStr: string): string {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return ('0' + d.getDate()).slice(-2) + '/' + ('0' + (d.getMonth() + 1)).slice(-2);
  },
};

(window as any).Notifs = Notifs;
