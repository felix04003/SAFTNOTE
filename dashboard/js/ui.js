'use strict';

// ── HELPERS ────────────────────────────────────────────

/**
 * Échappe les caractères HTML dangereux pour prévenir les attaques XSS.
 * À utiliser chaque fois que des données utilisateur sont insérées via innerHTML.
 */
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cn(n) {
  return n == null ? 'var(--g400)' :
    n >= 16 ? 'var(--success)' :
    n >= 14 ? 'var(--vert)' :
    n >= 10 ? 'var(--orange)' :
    n >= 8 ? 'var(--warning)' : 'var(--rouge)';
}

function init2(s) {
  return s.split(' ').map(function(w) { return w[0]; }).join('').slice(0, 2).toUpperCase();
}

// ── TOAST ──────────────────────────────────────────────
function toast(msg, type) {
  type = type || '';
  var el = document.createElement('div');
  el.className = 'toast ' + (type === 's' ? 's' : type === 'w' ? 'w' : type === 'd' ? 'd' : '');
  el.innerHTML = (type === 's' ? '&#10003; ' : type === 'd' ? '&#10007; ' : type === 'w' ? '&#9888; ' : '&#8505; ') + msg;
  document.getElementById('tc').appendChild(el);
  setTimeout(function() { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3000);
  setTimeout(function() { el.remove(); }, 3500);
}

// ── MODAL ──────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.addEventListener('click', function(e) {
  if (e.target.classList.contains('mo')) closeModal(e.target.id);
});

// ── FILTER TABS ────────────────────────────────────────
function ftSwitch(el) {
  el.parentNode.querySelectorAll('.ftab').forEach(function(t) {
    t.classList.remove('actif');
  });
  el.classList.add('actif');
}

// ── SPARKLINES ─────────────────────────────────────────
function sparkline(id, data, c) {
  var w = document.getElementById(id);
  if (!w) return;
  var mx = Math.max.apply(null, data);
  w.innerHTML = data.map(function(v) {
    return '<div class="sb" style="height:' + Math.max(18, v / mx * 100) + '%;--c:' + c + '"></div>';
  }).join('');
}
