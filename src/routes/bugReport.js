const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth');
const bugReportController = require('../controllers/bugReportController');

router.post('/', requireAuth, bugReportController.createBugReport);

module.exports = router;
