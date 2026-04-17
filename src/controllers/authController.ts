import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { 
  createUser, 
  findUserByEmail, 
  checkUserExists 
} from '../models/userModel';

// How long a login token lasts before expiring
const TOKEN_EXPIRY = '7d';

// =============================================
// REGISTER
// POST /api/auth/register
// Creates a new user account
// =============================================
export const register = async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, email, password } = req.body;

    // Validate that all fields are provided
    if (!username || !email || !password) {
      res.status(400).json({
        success: false,
        message: 'Username, email and password are required'
      });
      return;
    }

    // Validate password length
    if (password.length < 6) {
      res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
      return;
    }

    // Check if username or email already taken
    const exists = await checkUserExists(username, email);
    if (exists) {
      res.status(409).json({
        success: false,
        message: 'Username or email already taken'
      });
      return;
    }

    // Create the user in the database
    const user = await createUser({ username, email, password });

    // Generate a JWT token so they're logged in immediately
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: TOKEN_EXPIRY }
    );

    // Send back the token and user info
    // Never send back the password hash
    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during registration'
    });
  }
};

// =============================================
// LOGIN
// POST /api/auth/login
// Logs in an existing user
// =============================================
export const login = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    // Validate fields
    if (!email || !password) {
      res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
      return;
    }

    // Find the user by email
    const user = await findUserByEmail(email);

    // If user not found send generic error
    // Never tell them specifically if email or password is wrong
    // that gives hackers information
    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Compare the provided password against the stored hash
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
      return;
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      process.env.JWT_SECRET as string,
      { expiresIn: TOKEN_EXPIRY }
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        created_at: user.created_at
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// =============================================
// GET CURRENT USER
// GET /api/auth/me
// Returns the logged in user's info
// =============================================
export const getMe = async (req: Request, res: Response): Promise<void> => {
  try {
    // req.user is set by our auth middleware
    // we'll build that next
    const user = (req as any).user;

    res.status(200).json({
      success: true,
      user
    });

  } catch (error) {
    console.error('GetMe error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};