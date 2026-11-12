/**
 * 数据库初始化：读取 sql/schema.sql 并在 MySQL 中执行（支持多语句）
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

async function run() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');

  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    multipleStatements: true,
    charset: 'utf8mb4'
  });

  try {
    await pool.query(sql);
    console.log('✅ 数据库初始化完成（llm_rag，含测试数据）');
  } catch (e) {
    console.error('❌ 数据库初始化失败：', e.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

run();
