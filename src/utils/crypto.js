const crypto = require('crypto');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return `${salt.toString('base64')}.${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const parts = stored.split('.');
  if (parts.length !== 2) return false;
  const salt = Buffer.from(parts[0], 'base64');
  const expectedHash = Buffer.from(parts[1], 'base64');
  const actualHash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
  return crypto.timingSafeEqual(actualHash, expectedHash);
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars[crypto.randomInt(chars.length)];
  }
  return result;
}

module.exports = {
  hashPassword,
  verifyPassword,
  generateCode
};
