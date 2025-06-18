require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./core/auth'); // Our passport config
require('./db/sqlite'); // This initializes the database connection

const app = express();
const PORT = 8000;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Middleware
app.use(cors({ origin: FRONTEND_URL, credentials: true })); // Allow requests from our frontend
app.use(express.json());

// Session Middleware
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

// Passport Middleware
app.use(passport.initialize());
app.use(passport.session());

const repoRoutes = require('./api/repos.routes');

// --- Authentication Routes ---
app.get('/api/auth/github', passport.authenticate('github'));

app.get(
  '/api/auth/github/callback',
  passport.authenticate('github', { failureRedirect: `${FRONTEND_URL}/login` }),
  (req, res) => {
    // Successful authentication, redirect to the frontend dashboard.
    res.redirect(`${FRONTEND_URL}/dashboard`);
  }
);

// --- Protected Routes ---
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'User not authenticated' });
};

app.get('/api/me', isAuthenticated, (req, res) => {
  // req.user is populated by Passport's deserializeUser
  res.json(req.user);
});

app.post('/api/auth/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Quillarto backend listening on http://localhost:${PORT}`);
});

// --- API Routes ---
const docRoutes = require('./api/docs.routes');
const assetRoutes = require('./api/assets.routes');
const collabRoutes = require('./api/collab.routes');

app.use('/api/repos', repoRoutes);
app.use('/api/docs', docRoutes);
app.use('/api/assets', assetRoutes);

// --- Public API Routes ---
app.use('/api/collab', collabRoutes);