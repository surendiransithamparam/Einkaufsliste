const express = require('express');
const router = express.Router();
const haushaltController = require('../controllers/haushaltController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.post('/', requireAuth, authContext, haushaltController.create);
router.post('/join', requireAuth, authContext, haushaltController.join);
router.post('/leave', requireAuth, authContext, haushaltController.leave);
router.get('/mitglieder', requireAuth, authContext, haushaltController.getMitglieder);
router.put('/name', requireAuth, authContext, haushaltController.rename);
router.put('/rolle', requireAuth, authContext, haushaltController.updateRolle);

module.exports = router;
