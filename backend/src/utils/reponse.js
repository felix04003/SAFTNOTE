'use strict';

/**
 * Helpers pour construire des réponses API cohérentes.
 *
 * Format succès :
 * { succes: true, data: {...}, meta: { total, page, limite } }
 *
 * Format erreur :
 * { succes: false, erreur: "...", code: "CODE", details: [...] }
 */

function ok(res, data, statusCode = 200) {
  return res.status(statusCode).json({ succes: true, data });
}

function cree(res, data) {
  return ok(res, data, 201);
}

function liste(res, items, meta = {}) {
  return res.status(200).json({
    succes: true,
    data:   items,
    meta:   { total: items.length, ...meta },
  });
}

function paginee(res, items, { total, page, limite }) {
  return res.status(200).json({
    succes: true,
    data:   items,
    meta: {
      total,
      page,
      limite,
      pages: Math.ceil(total / limite),
    },
  });
}

function vide(res) {
  return res.status(204).send();
}

/**
 * Extrait les paramètres de pagination depuis req.query.
 * @returns {{ page, limite, offset }}
 */
function getPagination(query) {
  const page   = Math.max(1, parseInt(query.page)   || 1);
  const limite = Math.min(100, parseInt(query.limite) || 20);
  const offset = (page - 1) * limite;
  return { page, limite, offset };
}

module.exports = { ok, cree, liste, paginee, vide, getPagination };
