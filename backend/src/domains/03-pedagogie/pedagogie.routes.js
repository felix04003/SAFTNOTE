// src/domains/03-pedagogie/pedagogie.routes.js
'use strict';
const express = require('express');
const router  = express.Router();
router.use(require('./evaluations/evaluations.routes'));
router.use(require('./bulletins/bulletins.routes'));
router.use(require('./moyennes/moyennes.routes'));
router.use(require('./configs/configs.routes'));
module.exports = router;
