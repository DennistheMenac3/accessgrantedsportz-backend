import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

// Log connection details so we can debug
console.log('🔍 Attempting database connection with:');
console.log(`   Host:     ${process.env.DB_HOST}`);
console.log(`   Port:     ${process.env.DB_PORT}`);
console.log(`   Database: ${process.env.DB_NAME}`);
console.log(`   User:     ${process.env.DB_USER}`);

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test connection immediately on startup
pool.connect((err, client, release) => {
  if (err) {
    console.error('❌ Database connection failed:', err.message);
    console.error('❌ Full error:', err);
    return;
  }
  console.log('✅ Connected to AccessGrantedSportz database');
  release();
});

pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

export const query = async (text: string, params?: any[]) => {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    console.log('Query executed', {
      text,
      duration: `${duration}ms`,
      rows: result.rowCount
    });
    return result;
  } catch (error) {
    console.error('❌ Query error:', error);
    throw error;
  }
};

export const getClient = async () => {
  const client = await pool.connect();
  const originalQuery = client.query.bind(client);
  const release = client.release.bind(client);

  const timeout = setTimeout(() => {
    console.error('❌ Client checkout exceeded 5 seconds');
  }, 5000);

  client.release = () => {
    clearTimeout(timeout);
    return release();
  };

  return client;
};

export default pool;