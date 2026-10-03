const express = require('express'), session = require('express-session'), bcrypt = require('bcryptjs'), path = require('path');
const pool = require('./db'), app = express();
app.use(express.json());
app.use(session({ secret: 'change-this-secret', resave: false, saveUninitialized: false, cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 864e5 } }));
app.use(express.static(path.join(__dirname, 'public')));
const wrap = f => (req, res) => f(req, res).catch(e => { console.error(e); res.status(500).json({ error: 'Server error. Check the terminal.' }); });
const need = (req, res, next) => req.session.uid ? next() : res.status(401).json({ error: 'Log in first.' });
const q = (sql, p) => pool.query(sql, p);

let cache = null;   // the weather data never changes, so build it once
app.get('/api/data', wrap(async (req, res) => {
  if (!cache) {
    const st = (await q('SELECT name,state,lat,lon,terrain FROM stations ORDER BY id')).rows;
    const ob = (await q(`SELECT station_id,issue_date::text AS d,max_temp,min_temp,min_humidity,wind,max_1d,max_2d,avg7_max,normal_max,target_max,target_heatwave FROM weather_observations`)).rows;
    const mp = Object.fromEntries((await q('SELECT name,params FROM model_params')).rows.map(r => [r.name, r.params]));
    const dates = [...new Set(ob.map(r => r.d))].sort(), di = new Map(dates.map((d, i) => [d, i]));
    const F = ['max_temp', 'min_temp', 'min_humidity', 'wind', 'max_1d', 'max_2d', 'avg7_max', 'normal_max'];
    const X = F.map(() => st.map(() => Array(dates.length).fill(0))), A = st.map(() => Array(dates.length).fill(0)), Y = st.map(() => Array(dates.length).fill(false));
    for (const r of ob) { const s = r.station_id - 1, d = di.get(r.d); F.forEach((f, k) => X[k][s][d] = r[f]); A[s][d] = r.target_max; Y[s][d] = r.target_heatwave; }
    cache = { M: mp.M, dates, S: st.map(s => ({ n: s.name, s: s.state, lat: s.lat, lon: s.lon, t: s.terrain })), X, A, Y, C: mp.C, R: mp.R };
  }
  res.json(cache);
}));

app.get('/api/alerts', wrap(async (req, res) => {
  const d = req.query.date, th = parseFloat(req.query.th);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !(th >= 0 && th <= 1)) return res.status(400).json({ error: 'Bad date or threshold.' });
  const rows = (await q(`SELECT s.name, f.probability,
      CASE WHEN f.probability >= $2::float8*2 THEN 'RED' WHEN f.probability >= $2::float8*1.4 THEN 'ORANGE' ELSE 'YELLOW' END AS level
    FROM forecasts f JOIN stations s ON s.id = f.station_id
    WHERE f.issue_date = $1 AND f.probability >= $2::float8 ORDER BY f.probability DESC`, [d, th])).rows;
  const logged = (await q('SELECT count(*)::int AS c FROM alert_logs WHERE issue_date = $1', [d])).rows[0].c;
  const threshold = (await q('SELECT threshold FROM settings WHERE id = 1')).rows[0].threshold;
  res.json({ rows, logged, threshold });
}));

const creds = (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email) || typeof password !== 'string' || password.length < 8) { res.status(400).json({ error: 'Enter a valid email and a password of 8+ characters.' }); return null; }
  return [email.trim().toLowerCase(), password];
};
app.post('/api/signup', wrap(async (req, res) => {
  const c = creds(req, res); if (!c) return;
  try {
    const r = await q('INSERT INTO users(email,password_hash) VALUES($1,$2) RETURNING id', [c[0], await bcrypt.hash(c[1], 10)]);
    req.session.uid = r.rows[0].id; req.session.email = c[0]; res.json({ email: c[0] });
  } catch (e) { if (e.code === '23505') return res.status(409).json({ error: 'That email already has an account. Log in instead.' }); throw e; }
}));
app.post('/api/login', wrap(async (req, res) => {
  const c = creds(req, res); if (!c) return;
  const u = (await q('SELECT id,password_hash FROM users WHERE email=$1', [c[0]])).rows[0];
  if (!u || !(await bcrypt.compare(c[1], u.password_hash))) return res.status(401).json({ error: 'Email or password is incorrect.' });
  req.session.uid = u.id; req.session.email = c[0]; res.json({ email: c[0] });
}));
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => res.json({ email: req.session.email || null }));

app.get('/api/cities', need, wrap(async (req, res) => {
  res.json({ cities: (await q('SELECT id, city_name AS name, station_id-1 AS i, select_value AS v, lat AS la, lon AS lo FROM saved_cities WHERE user_id=$1 ORDER BY id', [req.session.uid])).rows });
}));
app.post('/api/cities', need, wrap(async (req, res) => {
  const { name, i, v, la, lo } = req.body || {};
  if (typeof name !== 'string' || !name || name.length > 100 || !Number.isInteger(i)) return res.status(400).json({ error: 'Bad city.' });
  const r = await q(`INSERT INTO saved_cities(user_id,city_name,station_id,select_value,lat,lon) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id,city_name) DO NOTHING RETURNING id`,
    [req.session.uid, name, i + 1, typeof v === 'string' ? v.slice(0, 10) : null, parseFloat(la) || null, parseFloat(lo) || null]);
  res.json({ city: r.rows[0] ? { id: r.rows[0].id, name, i, v, la, lo } : null });
}));
app.delete('/api/cities/:id', need, wrap(async (req, res) => {
  await q('DELETE FROM saved_cities WHERE id=$1 AND user_id=$2', [parseInt(req.params.id), req.session.uid]); res.json({ ok: true });
}));

app.get('/api/history', wrap(async (req, res) => {
  const st = parseInt(req.query.station), d = req.query.date;
  if (!Number.isInteger(st) || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ error: 'Bad station or date.' });
  const rows = (await q('SELECT start_date::text AS began, end_date::text AS ended, days, peak_temp AS peak FROM heatwave_history($1, $2::date) LIMIT 8', [st, d])).rows;
  const t = (await q('SELECT count(*)::int AS episodes, coalesce(sum(days),0)::int AS total FROM heatwave_history($1, $2::date)', [st, d])).rows[0];
  res.json({ rows, episodes: t.episodes, total: t.total });
}));
app.get('/api/scorecard', wrap(async (req, res) => {
  res.json({ rows: (await q(`SELECT CASE WHEN f.probability < 0.05 THEN 1 WHEN f.probability < 0.11 THEN 2 WHEN f.probability < 0.2 THEN 3 ELSE 4 END AS bucket,
      count(*)::int AS n, sum(o.target_heatwave::int)::int AS hits
    FROM forecasts f JOIN weather_observations o USING (station_id, issue_date) GROUP BY 1 ORDER BY 1`)).rows });
}));

app.listen(3000, () => console.log('Open http://localhost:3000'));
