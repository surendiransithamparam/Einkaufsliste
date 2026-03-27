const express = require('express');
const router = express.Router();
const wochenplanController = require('../controllers/wochenplanController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, wochenplanController.getAll);
router.post('/', requireAuth, wochenplanController.upsert);
router.delete('/:id', requireAuth, wochenplanController.remove);

module.exports = router;
