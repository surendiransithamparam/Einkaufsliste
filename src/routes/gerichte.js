const express = require('express');
const router = express.Router();
const gerichteController = require('../controllers/gerichteController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, gerichteController.getAll);
router.get('/:id', requireAuth, gerichteController.getById);
router.post('/', requireAuth, gerichteController.create);
router.put('/:id', requireAuth, gerichteController.update);
router.delete('/:id', requireAuth, gerichteController.remove);

module.exports = router;
