const express = require('express');
const router = express.Router();
const artikelController = require('../controllers/artikelController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, artikelController.getAll);
router.post('/', requireAuth, artikelController.create);
router.post('/bulk', requireAuth, artikelController.bulkCreate);
router.put('/:id', requireAuth, artikelController.update);
router.delete('/gekauft', requireAuth, artikelController.deleteGekauft);
router.delete('/:id', requireAuth, artikelController.remove);

module.exports = router;
