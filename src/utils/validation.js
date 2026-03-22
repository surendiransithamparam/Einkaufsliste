function validatePassword(pass) {
  if (pass.length < 8) return 'Passwort muss mindestens 8 Zeichen haben.';
  if (!/[A-Z]/.test(pass)) return 'Passwort muss mindestens einen Grossbuchstaben enthalten.';
  if (!/[a-z]/.test(pass)) return 'Passwort muss mindestens einen Kleinbuchstaben enthalten.';
  if (!/[^A-Za-z0-9]/.test(pass)) return 'Passwort muss mindestens ein Sonderzeichen enthalten.';
  return null;
}

module.exports = {
  validatePassword
};
