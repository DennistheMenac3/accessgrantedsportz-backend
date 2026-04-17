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
        host:     process.env.DB_HOST,
        port:     parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME,
        user:     process.env.DB_USER,
        password: process.env.DB_PASSWORD
      }
);

// =============================================
// Test connection on startup
// =============================================
const connectDB = async (): Promise<void> => {
  console.log('🔍 Attempting database connection with:');
  console.log(`   Host:     ${process.env.DB_HOST || 'Railway URL'}`);
  console.log(`   Port:     ${process.env.DB_PORT || '5432'}`);
  console.log(`   Database: ${process.env.DB_NAME || 'railway'}`);
  console.log(`   User:     ${process.env.DB_USER || 'postgres'}`);

  try {
    const client = await pool.connect();
    client.release();
    console.log('✅ Connected to AccessGrantedSportz database');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
  }
};

connectDB();

// =============================================
// Query helper — used throughout the app
// =============================================
export const query = async (
  text:   string,
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