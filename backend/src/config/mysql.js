const mysql = require('mysql2/promise');

let pool;

async function initMySQL() {
  pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: parseInt(process.env.MYSQL_PORT || '3306'),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'auction_master',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
  });
  
  console.log('MySQL Pool Initialized');
  return pool;
}

function getMySQLPool() {
  return pool;
}

module.exports = { initMySQL, getMySQLPool };
