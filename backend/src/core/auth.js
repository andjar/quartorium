const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const db = require('../db/sqlite');

// Passport needs to be able to serialize and deserialize users to support persistent login sessions
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
    done(err, user);
  });
});

// Configure the GitHub strategy
passport.use(
  new GitHubStrategy(
    {
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL || 'http://localhost:8000/api/auth/github/callback',
    },
    (accessToken, refreshToken, profile, done) => {
      // This function is called after a user successfully authenticates with GitHub.
      // We need to find or create a user in our own database.
      const githubId = profile.id;
      const username = profile.username;
      const avatarUrl = profile.photos[0].value;

      db.get('SELECT * FROM users WHERE github_id = ?', [githubId], (err, user) => {
        if (err) {
          return done(err);
        }
        if (user) {
          // User already exists, just pass them along
          return done(null, user);
        } else {
          // User is new, create them in our database
          const insertSql = 'INSERT INTO users (github_id, username, avatar_url) VALUES (?, ?, ?)';
          db.run(insertSql, [githubId, username, avatarUrl], function (err) {
            if (err) {
              return done(err);
            }
            const newUser = {
              id: this.lastID,
              github_id: githubId,
              username: username,
              avatar_url: avatarUrl,
            };
            return done(null, newUser);
          });
        }
      });
    }
  )
);

module.exports = passport;