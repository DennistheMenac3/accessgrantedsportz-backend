import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

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