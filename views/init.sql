-- Create users table
CREATE TABLE IF NOT EXISTS users (
  user_id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  points INTEGER DEFAULT 0
);

-- Create matches table with result fields
CREATE TABLE IF NOT EXISTS matches (
  match_id SERIAL PRIMARY KEY,
  team_a VARCHAR(100) NOT NULL,
  team_b VARCHAR(100) NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  venue VARCHAR(200),
  actual_winner VARCHAR(100),
  actual_score VARCHAR(20)
);

-- Create predictions table
CREATE TABLE IF NOT EXISTS predictions (
  prediction_id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(match_id),
  user_id INTEGER REFERENCES users(user_id),
  predicted_winner VARCHAR(100) NOT NULL,
  predicted_score VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert sample matches (replace with real fixtures)
INSERT INTO matches (team_a, team_b, match_date, venue) VALUES
  ('Team A', 'Team B', '2026-06-11 16:00:00+00', 'City 1 Stadium'),
  ('Team C', 'Team D', '2026-06-12 16:00:00+00', 'City 2 Stadium'),
  ('Team E', 'Team F', '2026-06-13 16:00:00+00', 'City 3 Stadium');