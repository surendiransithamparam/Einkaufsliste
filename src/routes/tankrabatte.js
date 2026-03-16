const express = require('express');
const router = express.Router();
const tankrabatteController = require('../controllers/tankrabatteController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, tankrabatteController.getTankrabatte);

module.exports = router;
