-- SQL script to create necessary tables and insert sample matches

-- Create matches table
CREATE TABLE IF NOT EXISTS matches (
  match_id SERIAL PRIMARY KEY,
  team_a VARCHAR(100) NOT NULL,
  team_b VARCHAR(100) NOT NULL,
  match_date TIMESTAMPTZ NOT NULL,
  venue VARCHAR(200)
);

-- Create predictions table
CREATE TABLE IF NOT EXISTS predictions (
  prediction_id SERIAL PRIMARY KEY,
  match_id INTEGER REFERENCES matches(match_id),
  user_id INTEGER,
  predicted_winner VARCHAR(100) NOT NULL,
  predicted_score VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert some sample matches (replace these with actual World Cup fixtures)
INSERT INTO matches (team_a, team_b, match_date, venue) VALUES
  ('Team A', 'Team B', '2026-06-11 16:00:00+00', 'City 1 Stadium'),
  ('Team C', 'Team D', '2026-06-12 16:00:00+00', 'City 2 Stadium'),
  ('Team E', 'Team F', '2026-06-13 16:00:00+00', 'City 3 Stadium');
