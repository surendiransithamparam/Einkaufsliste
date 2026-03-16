const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.get('/aktivieren', authController.activate);
router.post('/resend', authController.resendActivation);
router.post('/reset-request', authController.requestReset);
router.post('/reset', authController.performReset);
router.post('/logout', authController.logout);
router.get('/me', requireAuth, authController.getMe);
router.put('/profil', requireAuth, authController.updateProfile);
router.post('/change-password', requireAuth, authController.changePassword);

module.exports = router;
