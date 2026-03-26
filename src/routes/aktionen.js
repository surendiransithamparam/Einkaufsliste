const express = require('express');
const router = express.Router();
const aktionenController = require('../controllers/aktionenController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, aktionenController.search);
router.get('/match', requireAuth, authContext, aktionenController.match);
router.get('/alle', requireAuth, aktionenController.alle);
router.post('/refresh', requireAuth, aktionenController.refresh);

module.exports = router;
