import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { findUserById } from '../models/userModel';

// This extends the Express Request type
// so we can attach the user to it
export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email: string;
  };
}

// =============================================
// AUTH MIDDLEWARE
// Runs before any protected route
// Checks that the request has a valid token
// =============================================
export const protect = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    let token: string | undefined;

    // Tokens are sent in the Authorization header
    // Format: "Bearer eyJhbGciOiJIUzI1NiIs..."
    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith('Bearer')
    ) {
      // Extract just the token part after "Bearer "
      token = req.headers.authorization.split(' ')[1];
    }

    // If no token found reject the request
    if (!token) {
      res.status(401).json({
        success: false,
        message: 'Not authorized. Please log in.'
      });
      return;
    }

    // Verify the token is valid and not expired
    // If invalid jwt.verify throws an error
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as { userId: string; username: string };

    // Find the user in the database
    const user = await findUserById(decoded.userId);

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'User no longer exists'
      });
      return;
    }

    // Attach user to the request
    // Now any controller can access req.user
    req.user = {
      id: user.id,
      username: user.username,
      email: user.email
    };

    // Call next() to move on to the controller
    next();

  } catch (error) {
    res.status(401).json({
      success: false,
      message: 'Not authorized. Invalid token.'
    });
  }
};