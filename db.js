// EDIT THE PASSWORD BELOW: use the one you set when installing PostgreSQL.
const { Pool } = require('pg');
module.exports = new Pool({ host: 'localhost', port: 5432, user: 'postgres', password: '12345678', database: 'heatwave' });
