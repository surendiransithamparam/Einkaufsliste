const express = require('express');
const router = express.Router();
const gerichteController = require('../controllers/gerichteController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, authContext, gerichteController.getAll);
router.get('/:id', requireAuth, authContext, gerichteController.getById);
router.post('/', requireAuth, authContext, gerichteController.create);
router.put('/:id', requireAuth, authContext, gerichteController.update);
router.delete('/:id', requireAuth, authContext, gerichteController.remove);

module.exports = router;
