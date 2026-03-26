const express = require('express');
const router = express.Router();
const kundenkartenController = require('../controllers/kundenkartenController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

router.get('/', requireAuth, authContext, kundenkartenController.getAll);
router.post('/', requireAuth, authContext, kundenkartenController.create);
router.put('/:id', requireAuth, authContext, kundenkartenController.update);
router.delete('/:id', requireAuth, authContext, kundenkartenController.remove);

module.exports = router;
