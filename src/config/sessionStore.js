const session = require('express-session');
const { getPool, sql } = require('./db');

class MssqlStore extends session.Store {
  async get(sid, cb) {
    try {
      const pool = await getPool();
      if (!pool) return cb(new Error('DB not connected'));
      
      const result = await pool.request()
        .input('sid', sql.NVarChar, sid)
        .query('SELECT sess FROM Sessions WHERE sid=@sid AND expire > GETUTCDATE()');
      if (result.recordset.length === 0) return cb(null, null);
      cb(null, JSON.parse(result.recordset[0].sess));
    } catch (e) { cb(e); }
  }
  async set(sid, sess, cb) {
    try {
      const pool = await getPool();
      if (!pool) return cb(new Error('DB not connected'));

      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      const expire = new Date(Date.now() + maxAge);
      await pool.request()
        .input('sid', sql.NVarChar, sid)
        .input('sess', sql.NVarChar, JSON.stringify(sess))
        .input('expire', sql.DateTime, expire)
        .query(`MERGE Sessions AS t USING (SELECT @sid AS sid) AS s ON t.sid=s.sid
                WHEN MATCHED THEN UPDATE SET sess=@sess, expire=@expire
                WHEN NOT MATCHED THEN INSERT (sid,sess,expire) VALUES (@sid,@sess,@expire);`);
      cb(null);
    } catch (e) { cb(e); }
  }
  async destroy(sid, cb) {
    try {
      const pool = await getPool();
      if (!pool) return cb(new Error('DB not connected'));

      await pool.request().input('sid', sql.NVarChar, sid)
        .query('DELETE FROM Sessions WHERE sid=@sid');
      cb(null);
    } catch (e) { cb(e); }
  }
  async touch(sid, sess, cb) {
    try {
      const pool = await getPool();
      if (!pool) return cb(new Error('DB not connected'));

      const maxAge = (sess.cookie && sess.cookie.maxAge) || 86400000;
      const expire = new Date(Date.now() + maxAge);
      await pool.request()
        .input('sid', sql.NVarChar, sid)
        .input('expire', sql.DateTime, expire)
        .query('UPDATE Sessions SET expire=@expire WHERE sid=@sid');
      cb(null);
    } catch (e) { cb(e); }
  }
  startCleanup() {
    setInterval(async () => {
      try {
        const pool = await getPool();
        if (pool) {
            await pool.request().query('DELETE FROM Sessions WHERE expire < GETUTCDATE()');
        }
      } catch (e) { /* ignore cleanup errors */ }
    }, 15 * 60 * 1000); // every 15 minutes
  }
}

const sessionStore = new MssqlStore();
sessionStore.startCleanup();

module.exports = sessionStore;
