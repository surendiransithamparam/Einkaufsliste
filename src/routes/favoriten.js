const express = require('express');
const router = express.Router();
const favoritenController = require('../controllers/favoritenController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, authContext, favoritenController.getAll);
router.post('/', requireAuth, authContext, favoritenController.create);
router.delete('/:id', requireAuth, authContext, favoritenController.remove);

module.exports = router;
