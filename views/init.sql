-- Schema for World Cup knockout prediction app

CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_admin BOOLEAN DEFAULT FALSE,
  points INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS matches (
  match_id SERIAL PRIMARY KEY,
  team_a VARCHAR(100) NOT NULL,
  team_b VARCHAR(100) NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  venue VARCHAR(200),
  stage VARCHAR(20) DEFAULT 'group',
  actual_winner VARCHAR(100),
  actual_score VARCHAR(20),
  actual_penalty_winner VARCHAR(100),
  actual_penalty_score VARCHAR(20)
);

CREATE TABLE IF NOT EXISTS predictions (
  prediction_id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(match_id),
  user_id INTEGER REFERENCES users(user_id),
  predicted_winner VARCHAR(100) NOT NULL,
  predicted_score VARCHAR(20),
  predicted_penalty_winner VARCHAR(100),
  predicted_penalty_score VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sample matches (replace with real fixtures)
INSERT INTO matches (team_a, team_b, match_date, venue, stage) VALUES
  ('Team A','Team B','2026-06-11 16:00:00+00','City 1 Stadium','group'),
  ('Team C','Team D','2026-06-12 16:00:00+00','City 2 Stadium','round_16'),
  ('Team E','Team F','2026-06-13 16:00:00+00','City 3 Stadium','semi'),
  ('Team G','Team H','2026-06-14 16:00:00+00','City 4 Stadium','final');
