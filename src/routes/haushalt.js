const express = require('express');
const router = express.Router();
const haushaltController = require('../controllers/haushaltController');
const { requireAuth } = require('../middleware/auth');

router.post('/', requireAuth, haushaltController.create);
router.post('/join', requireAuth, haushaltController.join);
router.post('/leave', requireAuth, haushaltController.leave);
router.get('/mitglieder', requireAuth, haushaltController.getMitglieder);
router.put('/name', requireAuth, haushaltController.rename);
router.put('/rolle', requireAuth, haushaltController.updateRolle);

module.exports = router;
