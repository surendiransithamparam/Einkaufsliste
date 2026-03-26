const { isRateLimited } = require('../middleware/rateLimit');
const config = require('../config/config');

async function createBugReport(req, res) {
  try {
    if (isRateLimited(req, 'bugreport', 3, 600))
      return res.fail(429, 'Zu viele Meldungen. Bitte warte einige Minuten.');

    const { token, owner, repo } = config.github;
    if (!token || !owner || !repo)
      return res.fail(503, 'Bug-Report ist nicht konfiguriert.');

    const { titel, beschreibung, schritte, kontakt } = req.body;

    if (!titel || !titel.trim() || titel.trim().length > 100)
      return res.fail(400, 'Titel ist erforderlich (max. 100 Zeichen).');
    if (!beschreibung || !beschreibung.trim() || beschreibung.trim().length > 2000)
      return res.fail(400, 'Beschreibung ist erforderlich (max. 2000 Zeichen).');

    const parts = [`## Beschreibung\n\n${beschreibung.trim()}`];
    if (schritte && schritte.trim()) parts.push(`## Schritte zum Reproduzieren\n\n${schritte.trim()}`);
    if (kontakt && kontakt.trim()) parts.push(`## Kontakt\n\n${kontakt.trim()}`);
    const ua = req.headers['user-agent'] || 'Unbekannt';
    parts.push(`---\n_Gemeldet via App am ${new Date().toISOString()}_\n_User-Agent: ${ua}_`);

    const ghRes = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'User-Agent': 'HaushaltPLUS-App'
        },
        body: JSON.stringify({
          title: `[Bug] ${titel.trim()}`,
          body: parts.join('\n\n'),
          labels: ['bug', 'user-report']
        })
      }
    );

    if (!ghRes.ok) {
      const errText = await ghRes.text();
      console.error('GitHub API error:', ghRes.status, errText);
      return res.fail(502, 'Fehler beim Erstellen des Bug-Reports.');
    }

    const issue = await ghRes.json();
    res.ok({ success: true, issueNumber: issue.number });
  } catch (err) {
    console.error('bugreport error:', err);
    res.fail(500, 'Interner Fehler.');
  }
}

module.exports = {
  createBugReport
};
