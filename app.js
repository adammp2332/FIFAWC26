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

// Configure templating and static assets
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(cors());

// Database connection
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Sessions using Postgres-backed store
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

// Expose current user to templates
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user;
  next();
});

// Middleware restricting routes to admins only
function adminOnly(req, res, next) {
  if (!req.session.user || !req.session.user.is_admin) {
    return res.status(403).send('Access denied');
  }
  next();
}

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
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING user_id, email, is_admin',
      [email, hashed]
    );
    req.session.user = {
      user_id: result.rows[0].user_id,
      email: result.rows[0].email,
      is_admin: result.rows[0].is_admin
    };
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
      req.session.user = {
        user_id: user.user_id,
        email: user.email,
        is_admin: user.is_admin
      };
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

// Handle predictions submission
app.post('/predict', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  const {
    match_id,
    predicted_winner,
    predicted_score,
    predicted_penalty_winner,
    predicted_penalty_score
  } = req.body;
  const userId = req.session.user.user_id;
  try {
    const matchRes = await pool.query('SELECT match_date, stage FROM matches WHERE match_id = $1', [match_id]);
    if (matchRes.rows.length === 0) {
      return res.status(400).send('Match not found');
    }
    const matchDate = new Date(matchRes.rows[0].match_date);
    const now = new Date();
    // Prediction cutoff: 30 minutes before match start
    if (now > new Date(matchDate.getTime() - 30 * 60 * 1000)) {
      return res.send('Prediction window closed for this match.');
    }
    const stage = matchRes.rows[0].stage;
    const allowedStages = ['round_32', 'round_16', 'quarter', 'semi', 'third', 'final'];
    let penWinner = null;
    let penScore = null;
    if (allowedStages.includes(stage)) {
      penWinner = predicted_penalty_winner || null;
      penScore = predicted_penalty_score || null;
    }
    await pool.query(
      'INSERT INTO predictions (match_id, user_id, predicted_winner, predicted_score, predicted_penalty_winner, predicted_penalty_score) VALUES ($1,$2,$3,$4,$5,$6)',
      [match_id, userId, predicted_winner, predicted_score || null, penWinner, penScore]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Error saving prediction', err);
    res.status(500).send('Internal server error');
  }
});

// Points table: compute scores for each user
app.get('/points', async (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  try {
    const usersRes = await pool.query('SELECT user_id, email FROM users');
    const users = usersRes.rows;
    const multipliers = {
      group: 1,
      round_32: 1,
      round_16: 1,
      quarter: 1.5,
      semi: 2,
      third: 2,
      final: 3
    };
    for (const user of users) {
      const predsRes = await pool.query(
        `SELECT m.stage, m.actual_winner, m.actual_score, m.actual_penalty_winner, m.actual_penalty_score,
                m.match_date,
                p.predicted_winner, p.predicted_score, p.predicted_penalty_winner, p.predicted_penalty_score
         FROM predictions p
         JOIN matches m ON p.match_id = m.match_id
         WHERE p.user_id = $1
         ORDER BY m.match_date`,
        [user.user_id]
      );
      let points = 0;
      let streak = 0;
      predsRes.rows.forEach(row => {
        const stage = row.stage || 'group';
        const mult = multipliers[stage] || 1;
        const actualWinner = row.actual_winner;
        const actualScore = row.actual_score;
        const actualPenaltyWinner = row.actual_penalty_winner;
        const actualPenaltyScore = row.actual_penalty_score;
        const predictedWinner = row.predicted_winner;
        const predictedScore = row.predicted_score;
        const predictedPenaltyWinner = row.predicted_penalty_winner;
        const predictedPenaltyScore = row.predicted_penalty_score;
        if (!actualWinner && !actualPenaltyWinner) return;
        const isKnockout = stage !== 'group';
        const actualProgression = (actualWinner && actualWinner !== 'draw')
          ? actualWinner
          : actualPenaltyWinner;
        const predictedProgression = predictedPenaltyWinner || predictedWinner;
        let matchPoints = 0;

        if (isKnockout) {
          // Base progression points
          if (predictedProgression && actualProgression && predictedProgression === actualProgression) {
            matchPoints += 5;
            streak += 1;
          } else {
            matchPoints -= 2;
            streak = 0;
          }
          // Penalty for wrong normal-time outcome
          const normalOutcome = actualWinner || 'draw';
          if (predictedWinner && predictedWinner !== normalOutcome) {
            matchPoints -= 1;
          }
          // Score bonuses
          if (predictedScore && actualScore) {
            const [pHome,pAway] = predictedScore.split('-').map(Number);
            const [aHome,aAway] = actualScore.split('-').map(Number);
            if (pHome === aHome && pAway === aAway) {
              matchPoints += 3; // exact normal-time score
            } else if ((pHome - pAway) === (aHome - aAway)) {
              matchPoints += 1; // goal difference
            }
          }
          // Penalty bonuses
          if (actualPenaltyWinner) {
            if (predictedPenaltyWinner && predictedPenaltyWinner === actualPenaltyWinner) {
              matchPoints += 3;
            }
            if (predictedPenaltyScore && actualPenaltyScore && predictedPenaltyScore === actualPenaltyScore) {
              matchPoints += 1;
            }
          }
          // Streak bonus
          if (streak > 0 && streak % 5 === 0) {
            matchPoints += 2;
          }
          // Apply stage multiplier
          matchPoints *= mult;
        } else {
          // Group-stage scoring
          if (predictedWinner === actualWinner) {
            matchPoints += 3;
            streak += 1;
          } else {
            matchPoints -= 1;
            streak = 0;
          }
          if (predictedScore && actualScore) {
            const [pHome,pAway] = predictedScore.split('-').map(Number);
            const [aHome,aAway] = actualScore.split('-').map(Number);
            if (pHome === aHome && pAway === aAway) {
              matchPoints += 2;
            } else if ((pHome - pAway) === (aHome - aAway)) {
              matchPoints += 1;
            }
          }
          if (streak > 0 && streak % 5 === 0) {
            matchPoints += 2;
          }
        }
        points += matchPoints;
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

// ----------------------------------------------------------------------------
// Live score integration (football-data.org API)
// ----------------------------------------------------------------------------
const FOOTBALL_API_KEY = process.env.FOOTBALL_DATA_API_KEY;  // no default key

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
        let normalWinner = 'draw';
        if (m.score.winner === 'HOME_TEAM') normalWinner = home;
        else if (m.score.winner === 'AWAY_TEAM') normalWinner = away;
        const homeGoals = m.score.fullTime.home ?? 0;
        const awayGoals = m.score.fullTime.away ?? 0;
        const normalScore = `${homeGoals}-${awayGoals}`;
        let penaltyWinner = null;
        let penaltyScore = null;
        if (m.score.penalties && m.score.penalties.home != null && m.score.penalties.away != null) {
          const pHome = m.score.penalties.home;
          const pAway = m.score.penalties.away;
          penaltyScore = `${pHome}-${pAway}`;
          if (pHome > pAway) penaltyWinner = home;
          else if (pAway > pHome) penaltyWinner = away;
        }
        await pool.query(
          `UPDATE matches
             SET actual_winner = $1, actual_score = $2,
                 actual_penalty_winner = $3, actual_penalty_score = $4
           WHERE team_a = $5 AND team_b = $6`,
          [normalWinner, normalScore, penaltyWinner, penaltyScore, home, away]
        );
      }
    }
    console.log('Live scores updated');
  } catch (error) {
    console.error('Error fetching live scores', error.response ? error.response.data : error.message);
  }
}
fetchLiveScores();
setInterval(fetchLiveScores, 15 * 60 * 1000);

// ----------------------------------------------------------------------------
// Admin routes
// ----------------------------------------------------------------------------

// Admin dashboard
app.get('/admin', adminOnly, async (req, res) => {
  try {
    const matchesRes = await pool.query('SELECT * FROM matches ORDER BY match_date');
    const usersRes = await pool.query('SELECT user_id, email, is_admin FROM users ORDER BY user_id');
    res.render('admin', {
      matches: matchesRes.rows,
      users: usersRes.rows
    });
  } catch (err) {
    console.error('Error fetching admin data', err);
    res.status(500).send('Internal server error');
  }
});

// Update match details
app.post('/admin/update-match', adminOnly, async (req, res) => {
  const { match_id, actual_winner, actual_score, actual_penalty_winner, actual_penalty_score, stage } = req.body;
  try {
    await pool.query(
      'UPDATE matches SET actual_winner=$2, actual_score=$3, actual_penalty_winner=$4, actual_penalty_score=$5, stage=$6 WHERE match_id=$1',
      [
        match_id,
        actual_winner || null,
        actual_score || null,
        actual_penalty_winner || null,
        actual_penalty_score || null,
        stage || 'group'
      ]
    );
    res.redirect('/admin');
  } catch (err) {
    console.error('Error updating match', err);
    res.status(500).send('Internal server error');
  }
});

// Add match
app.post('/admin/add-match', adminOnly, async (req, res) => {
  const { team_a, team_b, match_date, venue, stage } = req.body;
  try {
    await pool.query(
      'INSERT INTO matches (team_a, team_b, match_date, venue, stage) VALUES ($1,$2,$3,$4,$5)',
      [team_a, team_b, new Date(match_date), venue || null, stage || 'group']
    );
    res.redirect('/admin');
  } catch (err) {
    console.error('Error adding match', err);
    res.status(500).send('Internal server error');
  }
});

// Update user admin status
app.post('/admin/update-user', adminOnly, async (req, res) => {
  const { user_id, is_admin } = req.body;
  try {
    await pool.query('UPDATE users SET is_admin=$2 WHERE user_id=$1', [user_id, is_admin === 'true']);
    res.redirect('/admin');
  } catch (err) {
    console.error('Error updating user', err);
    res.status(500).send('Internal server error');
  }
});

// Catch-all 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Start server
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
