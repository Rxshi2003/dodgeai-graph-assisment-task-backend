const { Pool } = require('pg');
const envConfig = require('../config/env');

const pool = new Pool({
  user: envConfig.DB_USER,
  host: envConfig.DB_HOST,
  database: envConfig.DB_NAME,
  password: envConfig.DB_PASSWORD,
  port: envConfig.DB_PORT,
});

exports.pool = pool;

exports.executeReadOnlyQuery = async (sqlQuery) => {
  // Very basic security check to avoid destructive queries from LLM
  // Only permit SELECT or CTEs (WITH)
  const isReadOnly = /^\s*(SELECT|WITH)/i.test(sqlQuery);
  if (!isReadOnly) {
    throw new Error('Security Error: LLM attempted to generate a non-SELECT query. Aborting execution.');
  }

  const client = await pool.connect();
  try {
    console.log(`[DB Service] Executing Query...`);
    const result = await client.query(sqlQuery);
    return result.rows;
  } catch (err) {
    console.error('[DB Service Error]:', err.message);
    throw err;
  } finally {
    client.release();
  }
};
