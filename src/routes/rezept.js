const express = require('express');
const router = express.Router();
const rezeptController = require('../controllers/rezeptController');
const { requireAuth } = require('../middleware/auth');

router.get('/suche', requireAuth, rezeptController.suche);
router.get('/zutaten', requireAuth, rezeptController.zutaten);

module.exports = router;
