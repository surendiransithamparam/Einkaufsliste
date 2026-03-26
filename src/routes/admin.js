const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const kundenkartenController = require('../controllers/kundenkartenController');
const { requireAuth } = require('../middleware/auth');
const authContext = require('../middleware/authContext');

// Benutzer
router.get('/benutzer', requireAuth, authContext, adminController.getBenutzer);
router.put('/benutzer/:id', requireAuth, authContext, adminController.updateBenutzer);
router.delete('/benutzer/:id', requireAuth, authContext, adminController.deleteBenutzer);

// Haushalte
router.get('/haushalte', requireAuth, authContext, adminController.getHaushalte);
router.get('/haushalte/:id/mitglieder', requireAuth, authContext, adminController.getHaushaltMitglieder);
router.put('/haushalte/:id', requireAuth, authContext, adminController.updateHaushalt);
router.put('/haushalte/:hid/mitglieder/:uid', requireAuth, authContext, adminController.updateHaushaltMitglied);
router.delete('/haushalte/:hid/mitglieder/:uid', requireAuth, authContext, adminController.removeHaushaltMitglied);
router.delete('/haushalte/:id', requireAuth, authContext, adminController.deleteHaushalt);

// Laden
router.post('/laden', requireAuth, authContext, adminController.createLaden);
router.put('/laden/:id', requireAuth, authContext, adminController.updateLaden);
router.delete('/laden/:id', requireAuth, authContext, adminController.deleteLaden);

// Kundenkarten-Logos
router.get('/kundenkarten-logos', requireAuth, authContext, adminController.getKundenkartenLogos);
router.put('/kundenkarten-logos', requireAuth, authContext, adminController.updateKundenkartenLogo);

module.exports = router;
