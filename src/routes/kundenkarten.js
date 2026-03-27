const express = require('express');
const router = express.Router();
const kundenkartenController = require('../controllers/kundenkartenController');
const { requireAuth } = require('../middleware/auth');

router.get('/', requireAuth, kundenkartenController.getAll);
router.post('/', requireAuth, kundenkartenController.create);
router.put('/:id', requireAuth, kundenkartenController.update);
router.delete('/:id', requireAuth, kundenkartenController.remove);

module.exports = router;
