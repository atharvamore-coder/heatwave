const pool = require('./db'), D = JSON.parse(require('fs').readFileSync(__dirname + '/data.json', 'utf8'));
(async () => {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('TRUNCATE alert_logs, forecasts, weather_observations, model_params, settings, stations RESTART IDENTITY CASCADE');
    await c.query(`INSERT INTO stations(id,name,state,lat,lon,terrain) SELECT id,name,state,lat,lon,terrain FROM json_to_recordset($1::json) AS t(id int,name text,state text,lat float8,lon float8,terrain int)`, [JSON.stringify(D.stations)]);
    await c.query(`INSERT INTO settings(id,threshold) VALUES (1,$1)`, [D.model.M.th]);
    await c.query(`INSERT INTO model_params(name,params) VALUES ('M',$1::jsonb),('C',$2::jsonb),('R',$3::jsonb)`, [JSON.stringify(D.model.M), JSON.stringify(D.model.C), JSON.stringify(D.model.R)]);
    await c.query(`INSERT INTO weather_observations SELECT station_id,issue_date,max_temp,min_temp,min_humidity,wind,max_1d,max_2d,avg7_max,normal_max,target_max,target_heatwave FROM json_to_recordset($1::json) AS t(station_id int,issue_date date,max_temp float8,min_temp float8,min_humidity float8,wind float8,max_1d float8,max_2d float8,avg7_max float8,normal_max float8,target_max float8,target_heatwave boolean)`, [JSON.stringify(D.observations)]);
    await c.query(`INSERT INTO forecasts SELECT station_id,issue_date,probability,predicted_max_temp FROM json_to_recordset($1::json) AS t(station_id int,issue_date date,probability float8,predicted_max_temp float8)`, [JSON.stringify(D.forecasts)]);
    await c.query('COMMIT');
    for (const t of ['stations', 'weather_observations', 'forecasts', 'alert_logs'])
      console.log(t.padEnd(22), (await c.query(`SELECT count(*) FROM ${t}`)).rows[0].count, 'rows');
    console.log('alert_logs was filled automatically by the trigger.');
  } catch (e) { await c.query('ROLLBACK'); console.error('Seed failed:', e.message); process.exitCode = 1; }
  finally { c.release(); await pool.end(); }
})();
