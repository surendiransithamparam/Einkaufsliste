const express = require('express');
const router = express.Router();
const webauthnController = require('../controllers/webauthnController');
const { requireAuth } = require('../middleware/auth');

router.post('/register-options', requireAuth, webauthnController.registerOptions);
router.post('/register-verify', requireAuth, webauthnController.registerVerify);
router.post('/login-options', webauthnController.loginOptions);
router.post('/login-verify', webauthnController.loginVerify);
router.get('/credentials', requireAuth, webauthnController.listCredentials);
router.delete('/credentials/:id', requireAuth, webauthnController.deleteCredential);

module.exports = router;
