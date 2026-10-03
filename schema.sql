-- Heatwave Watch India: PostgreSQL schema. Run in the "heatwave" database. Re-running resets everything.
DROP TABLE IF EXISTS saved_cities, alert_logs, forecasts, weather_observations, model_params, settings, users, stations CASCADE;
DROP FUNCTION IF EXISTS log_alert() CASCADE;

CREATE TABLE stations (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, state TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL CHECK (lat BETWEEN 6 AND 37.5),
  lon DOUBLE PRECISION NOT NULL CHECK (lon BETWEEN 68 AND 98),
  terrain SMALLINT NOT NULL CHECK (terrain IN (0,1,2))  -- 0 plains, 1 coastal, 2 hilly
);
CREATE TABLE users (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE saved_cities (
  id SERIAL PRIMARY KEY, user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  city_name TEXT NOT NULL, station_id INT NOT NULL REFERENCES stations(id),
  select_value TEXT, lat DOUBLE PRECISION, lon DOUBLE PRECISION, UNIQUE (user_id, city_name)
);
CREATE TABLE weather_observations (
  station_id INT NOT NULL REFERENCES stations(id), issue_date DATE NOT NULL,
  max_temp DOUBLE PRECISION, min_temp DOUBLE PRECISION, min_humidity DOUBLE PRECISION CHECK (min_humidity BETWEEN 0 AND 100),
  wind DOUBLE PRECISION CHECK (wind >= 0), max_1d DOUBLE PRECISION, max_2d DOUBLE PRECISION, avg7_max DOUBLE PRECISION, normal_max DOUBLE PRECISION,
  target_max DOUBLE PRECISION,      -- observed max temp 5 days after issue_date
  target_heatwave BOOLEAN,          -- observed heatwave 5 days after issue_date
  PRIMARY KEY (station_id, issue_date)
);
CREATE TABLE forecasts (
  station_id INT NOT NULL, issue_date DATE NOT NULL,
  probability DOUBLE PRECISION NOT NULL CHECK (probability BETWEEN 0 AND 1), predicted_max_temp DOUBLE PRECISION NOT NULL,
  PRIMARY KEY (station_id, issue_date),
  FOREIGN KEY (station_id, issue_date) REFERENCES weather_observations ON DELETE CASCADE
);
CREATE TABLE alert_logs (
  id SERIAL PRIMARY KEY, station_id INT NOT NULL, issue_date DATE NOT NULL,
  probability DOUBLE PRECISION NOT NULL, level TEXT NOT NULL CHECK (level IN ('YELLOW','ORANGE','RED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (station_id, issue_date),
  FOREIGN KEY (station_id, issue_date) REFERENCES forecasts ON DELETE CASCADE
);
CREATE TABLE settings (id INT PRIMARY KEY CHECK (id = 1), threshold DOUBLE PRECISION NOT NULL CHECK (threshold BETWEEN 0 AND 1));
CREATE TABLE model_params (name TEXT PRIMARY KEY, params JSONB NOT NULL);
CREATE INDEX idx_forecasts_date_prob ON forecasts (issue_date, probability DESC);

CREATE FUNCTION log_alert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE th DOUBLE PRECISION;
BEGIN
  SELECT threshold INTO th FROM settings WHERE id = 1;
  IF NEW.probability >= th THEN
    INSERT INTO alert_logs (station_id, issue_date, probability, level)
    VALUES (NEW.station_id, NEW.issue_date, NEW.probability,
            CASE WHEN NEW.probability >= th*2 THEN 'RED' WHEN NEW.probability >= th*1.4 THEN 'ORANGE' ELSE 'YELLOW' END)
    ON CONFLICT (station_id, issue_date) DO UPDATE SET probability = EXCLUDED.probability, level = EXCLUDED.level;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_log_alert AFTER INSERT ON forecasts FOR EACH ROW EXECUTE FUNCTION log_alert();
