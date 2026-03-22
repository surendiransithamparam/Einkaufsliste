const fs = require('fs');
const path = require('path');

let config = {};
try {
  // Try to load from project root
  config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../config.json'), 'utf8'));
} catch {
  // console.warn('config.json not found or invalid, using env vars / defaults');
}

module.exports = {
  connectionString: process.env.DB_CONNECTION_STRING || config.connectionString || '',
  adminPassword: config.adminPassword || '',
  sessionSecret: config.sessionSecret || null,
  smtp: config.smtp || {},
  github: config.github || {
    token: process.env.GITHUB_TOKEN || '',
    owner: process.env.GITHUB_OWNER || 'surendiransithamparam',
    repo: process.env.GITHUB_REPO || 'HaushaltPLUS'
  },
  webauthn: {
    rpID: process.env.WEBAUTHN_RP_ID || (config.webauthn && config.webauthn.rpId) || null,
    rpName: process.env.WEBAUTHN_RP_NAME || (config.webauthn && config.webauthn.rpName) || 'Einkaufsliste',
    origin: process.env.WEBAUTHN_ORIGIN || (config.webauthn && config.webauthn.origin) || null
  }
};
