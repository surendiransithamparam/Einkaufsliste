const express = require('express');
const router = express.Router();
const favoritenController = require('../controllers/favoritenController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, favoritenController.getAll);
router.post('/', requireAuth, favoritenController.create);
router.delete('/:id', requireAuth, favoritenController.remove);

module.exports = router;
