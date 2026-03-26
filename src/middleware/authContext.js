const { getPool } = require('../config/db');
const { getHaushaltId, canWrite } = require('../utils/dbHelpers');

async function authContext(req, res, next) {
    try {
        const userId = req.session.userId;
        const db = await getPool();
        const hid = await getHaushaltId(userId, db);
        const writable = await canWrite(userId, db);
        req.ctx = { userId, hid, canWrite: writable, db };
        next();
    } catch (err) {
        console.error('authContext error:', err);
        res.status(500).json({ error: 'Interner Fehler' });
    }
}

module.exports = authContext;
