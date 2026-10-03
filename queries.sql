-- Demo queries for your viva
-- 1. Top 10 riskiest station-days
SELECT s.name, f.issue_date, round(f.probability::numeric,3) AS prob FROM forecasts f JOIN stations s ON s.id=f.station_id ORDER BY f.probability DESC LIMIT 10;
-- 2. Alerts written by the trigger, per state and level
SELECT s.state, a.level, count(*) FROM alert_logs a JOIN stations s ON s.id=a.station_id GROUP BY s.state, a.level ORDER BY s.state, a.level;
-- 3. Forecast vs observed heatwave: how many alerts were real? (precision)
SELECT count(*) FILTER (WHERE o.target_heatwave) AS true_alerts, count(*) AS all_alerts,
       round(100.0*count(*) FILTER (WHERE o.target_heatwave)/count(*),1) AS precision_pct
FROM alert_logs a JOIN weather_observations o USING (station_id, issue_date);
-- 4. Trigger demo: insert a forecast and watch alert_logs change
DELETE FROM forecasts WHERE station_id=1 AND issue_date='2024-01-01';
INSERT INTO forecasts VALUES (1,'2024-01-01',0.40,44.0);
SELECT * FROM alert_logs WHERE station_id=1 AND issue_date='2024-01-01';
