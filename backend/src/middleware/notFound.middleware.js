'use strict';

function notFound(req, res) {
  res.status(404).json({
    succes: false,
    erreur: `Route non trouvée : ${req.method} ${req.path}`,
    code:   'ROUTE_INTROUVABLE',
  });
}

module.exports = { notFound };
