const nodemailer = require('nodemailer');
const config = require('../config/config');

async function sendActivationEmail(email, username, token, req) {
  const host = config.smtp.host || '';
  const port = config.smtp.port || 587;
  const user = config.smtp.user || '';
  const pass = config.smtp.password || '';
  const fromAddr = config.smtp.from || user;
  const fromName = config.smtp.fromName || 'Haushalt⁺';

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/api/auth/aktivieren?token=${encodeURIComponent(token)}`;

  const body = `Hallo ${username},

Bitte bestätige deine E-Mail-Adresse, indem du auf folgenden Link klickst:

${link}

Falls du dich nicht registriert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
Haushalt⁺`;

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to: email,
    subject: 'Haushalt⁺ – E-Mail bestätigen',
    text: body
  });
}

async function sendResetEmail(email, username, token, req) {
  const host = config.smtp.host || '';
  const port = config.smtp.port || 587;
  const user = config.smtp.user || '';
  const pass = config.smtp.password || '';
  const fromAddr = config.smtp.from || user;
  const fromName = config.smtp.fromName || 'Haushalt⁺';

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const link = `${baseUrl}/reset.html?token=${encodeURIComponent(token)}`;

  const body = `Hallo ${username},

Du hast ein Zurücksetzen deines Passworts angefordert. Klicke auf folgenden Link:

${link}

Der Link ist 1 Stunde gültig.

Falls du dies nicht angefordert hast, kannst du diese E-Mail ignorieren.

Viele Grüsse
Haushalt⁺`;

  const transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass }
  });

  await transporter.sendMail({
    from: `"${fromName}" <${fromAddr}>`,
    to: email,
    subject: 'Haushalt⁺ – Passwort zurücksetzen',
    text: body
  });
}

module.exports = {
  sendActivationEmail,
  sendResetEmail
};
