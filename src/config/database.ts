import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool(
  process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      }
    : {
        host:     process.env.DB_HOST     || '127.0.0.1',
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME     || 'accessgrantedsportz',
        user:     process.env.DB_USER     || 'postgres',
        password: process.env.DB_PASSWORD || ''
      }
);

const connectDB = async (): Promise<void> => {
  try {
    const client = await pool.connect();
    client.release();
    console.log('✅ Connected to AccessGrantedSportz database');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
};

connectDB();

export const query = async (
  text:    string,
  params?: any[]
): Promise<QueryResult> => {
  try {
    const result = await pool.query(text, params);
    return result;
  } catch (error) {
    console.error('❌ Query error:', error);
    throw error;
  }
};

export default pool;