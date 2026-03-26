const express = require('express');
const router = express.Router();
const artikelController = require('../controllers/artikelController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, authContext, artikelController.getAll);
router.post('/', requireAuth, authContext, artikelController.create);
router.post('/bulk', requireAuth, authContext, artikelController.bulkCreate);
router.put('/:id', requireAuth, authContext, artikelController.update);
router.delete('/gekauft', requireAuth, authContext, artikelController.deleteGekauft);
router.delete('/:id', requireAuth, authContext, artikelController.remove);

module.exports = router;
