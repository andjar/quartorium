const passport = require('passport');
const GitHubStrategy = require('passport-github2').Strategy;
const db = require('../db/sqlite');

// Passport needs to be able to serialize and deserialize users to support persistent login sessions.
// Serialization determines what user data is stored in the session. We'll just store the user's ID.
passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Deserialization retrieves the full user data from the database based on the ID stored in the session.
// This is called on every request for an authenticated user.
passport.deserializeUser((id, done) => {
  db.get('SELECT * FROM users WHERE id = ?', [id], (err, user) => {
    done(err, user);
  });
});

// Configure the GitHub authentication strategy
passport.use(
  new GitHubStrategy(
    {
      // These are read from your .env file
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.CALLBACK_URL || 'http://localhost:8000/api/auth/github/callback',
      
      // Define the permissions we are requesting from the user here.
      // 'repo' is essential for accessing private repositories.
      scope: ['user:email', 'repo'], 
    },
    // This function is the "verify callback". It's called after a user successfully authenticates with GitHub.
    (accessToken, refreshToken, profile, done) => {
      const githubId = profile.id;
      const username = profile.username;
      const avatarUrl = profile.photos[0].value;

      // Find the user in our database based on their GitHub ID.
      db.get('SELECT * FROM users WHERE github_id = ?', [githubId], (err, user) => {
        if (err) {
          return done(err);
        }
        
        if (user) {
          // If user already exists, update their access token in case it has changed.
          // This is good practice for re-authentication.
          const updateSql = 'UPDATE users SET github_token = ? WHERE github_id = ?';
          db.run(updateSql, [accessToken, githubId]);
          
          // Pass the existing user to the next step.
          return done(null, user);
        } else {
          // If user is new, create a new record for them in our database.
          const insertSql = 'INSERT INTO users (github_id, username, avatar_url, github_token) VALUES (?, ?, ?, ?)';
          db.run(insertSql, [githubId, username, avatarUrl, accessToken], function (err) {
            if (err) {
              return done(err);
            }
            // Create a user object to pass to the next step.
            const newUser = {
              id: this.lastID, // The ID of the newly inserted row
              github_id: githubId,
              username: username,
              avatar_url: avatarUrl,
              github_token: accessToken,
            };
            return done(null, newUser);
          });
        }
      });
    }
  )
);

module.exports = passport;