const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const kundenkartenController = require('../controllers/kundenkartenController');
const { requireAuth } = require('../middleware/auth');

// Benutzer
router.get('/benutzer', requireAuth, adminController.getBenutzer);
router.put('/benutzer/:id', requireAuth, adminController.updateBenutzer);
router.delete('/benutzer/:id', requireAuth, adminController.deleteBenutzer);

// Haushalte
router.get('/haushalte', requireAuth, adminController.getHaushalte);
router.get('/haushalte/:id/mitglieder', requireAuth, adminController.getHaushaltMitglieder);
router.put('/haushalte/:id', requireAuth, adminController.updateHaushalt);
router.put('/haushalte/:hid/mitglieder/:uid', requireAuth, adminController.updateHaushaltMitglied);
router.delete('/haushalte/:hid/mitglieder/:uid', requireAuth, adminController.removeHaushaltMitglied);
router.delete('/haushalte/:id', requireAuth, adminController.deleteHaushalt);

// Laden
router.post('/laden', requireAuth, adminController.createLaden);
router.put('/laden/:id', requireAuth, adminController.updateLaden);
router.delete('/laden/:id', requireAuth, adminController.deleteLaden);

// Kundenkarten-Logos
router.get('/kundenkarten-logos', requireAuth, adminController.getKundenkartenLogos);
router.put('/kundenkarten-logos', requireAuth, adminController.updateKundenkartenLogo);

module.exports = router;
