const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config/config');
const sessionStore = require('./config/sessionStore');
const crypto = require('crypto');

// Routes
const authRoutes = require('./routes/auth');
const bugReportRoutes = require('./routes/bugReport');
const webauthnRoutes = require('./routes/webauthn');
const haushaltRoutes = require('./routes/haushalt');
const ladenRoutes = require('./routes/laden');
const artikelRoutes = require('./routes/artikel');
const wochenplanRoutes = require('./routes/wochenplan');
const kundenkartenRoutes = require('./routes/kundenkarten');
const gerichteRoutes = require('./routes/gerichte');
const rezeptRoutes = require('./routes/rezept');
const favoritenRoutes = require('./routes/favoriten');
const aktionenRoutes = require('./routes/aktionen');
const tankrabatteRoutes = require('./routes/tankrabatte');
const adminRoutes = require('./routes/admin');
const { requireAuth } = require('./middleware/auth');
const kundenkartenController = require('./controllers/kundenkartenController');

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

app.use(session({
  store: sessionStore,
  name: 'einkauf_auth',
  secret: config.sessionSecret || crypto.randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict'
  }
}));

// Serve static files - assumes src/app.js, so public is at ../public
app.use(express.static(path.join(process.cwd(), 'public')));

// --- Health Endpoint ---
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    dbConfigured: !!config.connectionString,
    environment: process.env.NODE_ENV || 'development',
    runtime: `Node.js ${process.version}`,
    os: `${process.platform} ${process.arch}`,
    arch: process.arch
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/bugreport', bugReportRoutes);
app.use('/api/webauthn', webauthnRoutes);
app.use('/api/haushalt', haushaltRoutes);
app.use('/api/laden', ladenRoutes);
app.use('/api/artikel', artikelRoutes);
app.use('/api/wochenplan', wochenplanRoutes);
app.use('/api/kundenkarten', kundenkartenRoutes);
app.use('/api/gerichte', gerichteRoutes);
app.use('/api/rezept', rezeptRoutes);
app.use('/api/favoriten', favoritenRoutes);
app.use('/api/aktionen', aktionenRoutes);
app.use('/api/tankrabatte', tankrabatteRoutes);
app.use('/api/admin', adminRoutes);

// Kundenkarten-Logos (public-ish, separate from admin)
app.get('/api/kundenkarten-logos', requireAuth, kundenkartenController.getLogos);

module.exports = app;
