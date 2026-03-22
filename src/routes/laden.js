const express = require('express');
const router = express.Router();
const ladenController = require('../controllers/ladenController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, ladenController.getAll);

module.exports = router;
