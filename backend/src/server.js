require('dotenv').config(); 

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const passport = require('./core/auth'); // Our passport config
const fs = require('fs');
const path = require('path');
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
  console.log(`🚀 Quartorium backend listening on http://localhost:${PORT}`);
});

// --- API Routes ---
const docRoutes = require('./api/docs.routes');
const liveDocsRouter = require('./api/live_docs.routes'); // Import the new router
const assetRoutes = require('./api/assets.routes');
const collabRoutes = require('./api/collab.routes');

app.use('/api/repos', repoRoutes);
app.use('/api/docs', docRoutes);
app.use('/api/docs', liveDocsRouter); // Use the new router for /api/docs
app.use('/api/assets', assetRoutes);

// --- Public API Routes ---
app.use('/api/collab', collabRoutes);

// --- Reset Route ---
app.post('/api/reset', (req, res) => {
  try {
    // Close the database connection first
    const db = require('./db/sqlite');
    db.close((err) => {
      if (err) {
        console.error('Error closing database:', err.message);
      } else {
        console.log('Database connection closed.');
      }
      
      // Delete the database file
      const dbPath = path.join(__dirname, 'db', 'quartorium.db');
      if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('✅ Database file deleted.');
      }
      
      // Empty the cache folder
      const cachePath = path.join(__dirname, '..', 'cache');
      if (fs.existsSync(cachePath)) {
        const cacheContents = fs.readdirSync(cachePath);
        cacheContents.forEach(item => {
          const itemPath = path.join(cachePath, item);
          if (fs.lstatSync(itemPath).isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemPath);
          }
        });
        console.log('✅ Cache folder emptied.');
      }
      
      // Empty the repos folder
      const reposPath = path.join(__dirname, '..', 'repos');
      if (fs.existsSync(reposPath)) {
        const reposContents = fs.readdirSync(reposPath);
        reposContents.forEach(item => {
          const itemPath = path.join(reposPath, item);
          if (fs.lstatSync(itemPath).isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(itemPath);
          }
        });
        console.log('✅ Repos folder emptied.');
      }
      
      // Reinitialize the database
      require('./db/sqlite');
      
      res.json({ 
        success: true, 
        message: 'Reset completed successfully. Database deleted and cache/repos folders emptied.' 
      });
    });
  } catch (error) {
    console.error('Error during reset:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to reset the system',
      details: error.message 
    });
  }
});