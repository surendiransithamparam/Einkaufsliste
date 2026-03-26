const express = require('express');
const router = express.Router();
const wochenplanController = require('../controllers/wochenplanController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, authContext, wochenplanController.getAll);
router.post('/', requireAuth, authContext, wochenplanController.upsert);
router.delete('/:id', requireAuth, authContext, wochenplanController.remove);

module.exports = router;
