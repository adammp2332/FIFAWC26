require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const axios = require('axios');
const { Pool } = require('pg');

const app = express();

// Configure view engine and static assets
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sessions using Postgres-backed session store
const sessionSecret = process.env.SESSION_SECRET || 'keyboard cat';
app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: 'session'
    }),
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 1000 * 60 * 60 * 24 }
  })
);

// Make the current user available to templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user;
  next();
});

// Home page: list matches for prediction. Requires login.
app.get('/', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const { rows: matches } = await pool.query('SELECT * FROM matches ORDER BY match_date');
    res.render('index', { matches });
  } catch (err) {
    console.error('Error fetching matches', err);
    res.status(500).send('Internal server error');
  }
});

// Sign-up form
app.get('/signup', (req, res) => {
  res.render('signup');
});

// Handle sign-up
app.post('/signup', async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id, email',
      [email, hashed]
    );
    req.session.user = { user_id: result.rows[0].user_id, email: result.rows[0].email, points: 0 };
    res.redirect('/');
  } catch (err) {
    console.error('Error signing up', err);
    res.status(500).send('Internal server error');
  }
});

// Login form
app.get('/login', (req, res) => {
  res.render('login');
});

// Handle login
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];
    if (user && (await bcrypt.compare(password, user.password_hash))) {
      req.session.user = { user_id: user.user_id, email: user.email, points: user.points };
      return res.redirect('/');
    }
    return res.render('login', { error: 'Invalid email or password' });
  } catch (err) {
    console.error('Error logging in', err);
    res.status(500).send('Internal server error');
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// Handle predictions
app.post('/predict', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const { match_id, predicted_winner, predicted_score } = req.body;
  const userId = req.session.user.user_id;
  try {
    const matchRes = await pool.query('SELECT match_date FROM matches WHERE match_id = $1', [match_id]);
    if (matchRes.rows.length === 0) {
      return res.status(400).send('Match not found');
    }
    const matchDate = new Date(matchRes.rows[0].match_date);
    const now = new Date();
    if (now > new Date(matchDate.getTime() - 30 * 60 * 1000)) {
      return res.send('Prediction window closed for this match.');
    }
    await pool.query(
      'INSERT INTO predictions (match_id, user_id, predicted_winner, predicted_score) VALUES ($1, $2, $3, $4)',
      [match_id, userId, predicted_winner, predicted_score || null]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Error saving prediction', err);
    res.status(500).send('Internal server error');
  }
});

// Points table
app.get('/points', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const usersRes = await pool.query('SELECT user_id, email FROM users');
    const users = usersRes.rows;
    for (const user of users) {
      const predsRes = await pool.query(
        `SELECT p.predicted_winner, p.predicted_score, m.actual_winner, m.actual_score
         FROM predictions p
         JOIN matches m ON p.match_id = m.match_id
         WHERE p.user_id = $1`,
        [user.user_id]
      );
      let points = 0;
      predsRes.rows.forEach(row => {
        if (row.actual_winner && row.predicted_winner === row.actual_winner) {
          points += 1;
          if (row.actual_score && row.predicted_score && row.predicted_score === row.actual_score) {
            points += 2;
          }
        }
      });
      user.points = points;
    }
    users.sort((a, b) => b.points - a.points);
    res.render('points', { users });
  } catch (err) {
    console.error('Error computing points', err);
    res.status(500).send('Internal server error');
  }
});

// Score cards
app.get('/scores', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const { rows: matches } = await pool.query('SELECT * FROM matches ORDER BY match_date');
    res.render('scores', { matches });
  } catch (err) {
    console.error('Error fetching scores', err);
    res.status(500).send('Internal server error');
  }
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

// -----------------------------------------------------------------------------
// Live score integration with your API key
// -----------------------------------------------------------------------------
const FOOTBALL_API_KEY =
  process.env.FOOTBALL_DATA_API_KEY || 'c3a49603b9ca4edb911214f696a3d6fb';

async function fetchLiveScores() {
  if (!FOOTBALL_API_KEY) return;
  try {
    const response = await axios.get(
      'https://api.football-data.org/v4/competitions/WC/matches',
      { headers: { 'X-Auth-Token': FOOTBALL_API_KEY } }
    );
    const matchesApi = response.data.matches;
    for (const m of matchesApi) {
      if (m.status === 'FINISHED') {
        const home = m.homeTeam.name;
        const away = m.awayTeam.name;
        let winner = 'draw';
        if (m.score.winner === 'HOME_TEAM') winner = home;
        else if (m.score.winner === 'AWAY_TEAM') winner = away;
        const homeGoals = m.score.fullTime.home ?? 0;
        const awayGoals = m.score.fullTime.away ?? 0;
        const scoreStr = `${homeGoals}-${awayGoals}`;
        await pool.query(
          `UPDATE matches
           SET actual_winner = $1, actual_score = $2
           WHERE team_a = $3 AND team_b = $4`,
          [winner, scoreStr, home, away]
        );
      }
    }
    console.log('Live scores updated');
  } catch (error) {
    console.error(
      'Error fetching live scores',
      error.response ? error.response.data : error.message
    );
  }
}

// Fetch once on start and every 15 minutes
fetchLiveScores();
setInterval(fetchLiveScores, 15 * 60 * 1000);