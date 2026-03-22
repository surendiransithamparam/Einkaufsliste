const config = require('../config/config');

const webauthnConfigStatic = config.webauthn;

function getWebauthnConfig(req) {
  const host = req.hostname || req.headers.host?.split(':')[0] || 'localhost';
  const protocol = req.protocol || (req.secure ? 'https' : 'http');
  const port = req.headers.host?.includes(':') ? ':' + req.headers.host.split(':')[1] : '';
  return {
    rpID: webauthnConfigStatic.rpID || host,
    rpName: webauthnConfigStatic.rpName,
    origin: webauthnConfigStatic.origin || `${protocol}://${host}${port}`
  };
}

module.exports = { getWebauthnConfig };
