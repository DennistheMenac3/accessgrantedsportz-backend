import { query } from '../config/database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

// This is the shape of a User object
// TypeScript uses interfaces to define
// what properties an object must have
export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  created_at: Date;
  updated_at: Date;
}

// This is what we receive when registering
// We don't include id or timestamps
// because the database generates those
export interface CreateUserInput {
  username: string;
  email: string;
  password: string;
}

// Create a new user in the database
export const createUser = async (input: CreateUserInput): Promise<User> => {
  // Hash the password before storing it
  // NEVER store plain text passwords
  // 10 = how many times to scramble the hash
  // higher = more secure but slower
  const saltRounds = 10;
  const password_hash = await bcrypt.hash(input.password, saltRounds);

  const result = await query(
    `INSERT INTO users (id, username, email, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [uuidv4(), input.username, input.email, password_hash]
  );

  return result.rows[0];
};

// Find a user by their email address
// Used during login
export const findUserByEmail = async (email: string): Promise<User | null> => {
  const result = await query(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );

  // If no rows returned the user doesn't exist
  return result.rows[0] || null;
};

// Find a user by their ID
// Used to verify tokens
export const findUserById = async (id: string): Promise<User | null> => {
  const result = await query(
    `SELECT id, username, email, created_at, updated_at 
     FROM users WHERE id = $1`,
    [id]
  );

  return result.rows[0] || null;
};

// Check if a username or email already exists
// Used during registration to prevent duplicates
export const checkUserExists = async (
  username: string, 
  email: string
): Promise<boolean> => {
  const result = await query(
    `SELECT id FROM users 
     WHERE username = $1 OR email = $2`,
    [username, email]
  );

  return result.rows.length > 0;
};