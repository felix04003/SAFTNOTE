// src/domains/04-vie-scolaire/vie-scolaire.routes.js
'use strict';
const express = require('express');
const router  = express.Router();
router.use(require('./appels/appels.routes'));
router.use(require('./edt/edt.routes'));
router.use(require('./discipline/discipline.routes'));
router.use(require('./evenements/evenements.routes'));
module.exports = router;
