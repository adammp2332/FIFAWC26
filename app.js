require('dotenv').config();
const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();

// Use EJS for templating
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set up Postgres connection using DATABASE_URL environment variable
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Serve static assets (e.g., CSS)
app.use(express.static(path.join(__dirname, 'public')));

// Route to display matches and prediction form
app.get('/', async (req, res) => {
  try {
    const { rows: matches } = await pool.query('SELECT * FROM matches ORDER BY match_date');
    res.render('index', { matches });
  } catch (err) {
    console.error('Error fetching matches', err);
    res.status(500).send('Internal server error');
  }
});

// Route to handle prediction submissions
app.post('/predict', async (req, res) => {
  const { match_id, predicted_winner, predicted_score, user_id } = req.body;
  try {
    await pool.query(
      'INSERT INTO predictions (match_id, predicted_winner, predicted_score, user_id) VALUES ($1, $2, $3, $4)',
      [match_id, predicted_winner, predicted_score || null, user_id || null]
    );
    res.redirect('/');
  } catch (err) {
    console.error('Error saving prediction', err);
    res.status(500).send('Internal server error');
  }
});

// Start the server on the port provided by Render
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
