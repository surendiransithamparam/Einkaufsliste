const sql = require('mssql');
const config = require('./config');

let pool;

async function getPool() {
  if (pool) return pool;
  if (!config.connectionString) {
    // Return undefined or throw depending on how consumers handle it.
    // server.js checks if connStr is present for health check.
    return undefined; 
  }
  try {
      pool = await sql.connect(config.connectionString);
  } catch (err) {
      console.error('Database connection failed:', err);
      throw err;
  }
  return pool;
}

module.exports = {
  getPool,
  sql
};
