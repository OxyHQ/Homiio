/**
 * Authentication Controller
 * Handles user authentication and authorization
 */

const jwt = require('jsonwebtoken');
const config = require('../config');
const { successResponse, AppError } = require('../middlewares/errorHandler');
const { logger } = require('../middlewares/logging');

class AuthController {
  /**
   * User login
   */
  async login(req, res, next) {
    try {
      const { email, password } = req.body;

      // In a real implementation, validate credentials against database
      // const user = await UserModel.findByEmail(email);
      // const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      
      // Mock user validation for development
      if (email === 'admin@example.com' && password === 'password') {
        const user = {
          id: 'user_123',
          email: 'admin@example.com',
          username: 'admin',
          role: 'admin'
        };

        const accessToken = jwt.sign(
          { id: user.id, email: user.email, role: user.role },
          config.jwt.secret,
          { expiresIn: config.jwt.expiresIn }
        );

        const refreshToken = jwt.sign(
          { id: user.id, type: 'refresh' },
          config.jwt.refreshSecret,
          { expiresIn: config.jwt.refreshExpiresIn }
        );

        logger.info('User logged in successfully', { userId: user.id, email: user.email });

        res.json(successResponse({
          user,
          accessToken,
          refreshToken
        }, 'Login successful'));
      } else {
        throw new AppError('Invalid credentials', 401, 'UNAUTHORIZED');
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * User registration
   */
  async register(req, res, next) {
    try {
      const { email, password, username, firstName, lastName } = req.body;

      // In a real implementation, check if user exists and hash password
      // const existingUser = await UserModel.findByEmail(email);
      // if (existingUser) throw new AppError('User already exists', 400);
      // const passwordHash = await bcrypt.hash(password, 10);

      const newUser = {
        id: `user_${Date.now()}`,
        email,
        username,
        firstName,
        lastName,
        role: 'user',
        createdAt: new Date(),
        emailVerified: false
      };

      const accessToken = jwt.sign(
        { id: newUser.id, email: newUser.email, role: newUser.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      const refreshToken = jwt.sign(
        { id: newUser.id, type: 'refresh' },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn }
      );

      logger.info('User registered successfully', { userId: newUser.id, email: newUser.email });

      res.status(201).json(successResponse({
        user: newUser,
        accessToken,
        refreshToken
      }, 'Registration successful'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(req, res, next) {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        throw new AppError('Refresh token required', 400, 'BAD_REQUEST');
      }

      const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
      
      if (decoded.type !== 'refresh') {
        throw new AppError('Invalid refresh token', 401, 'UNAUTHORIZED');
      }

      // In a real implementation, check if refresh token is blacklisted
      // const isBlacklisted = await RefreshTokenModel.isBlacklisted(refreshToken);
      // if (isBlacklisted) throw new AppError('Token revoked', 401);

      const newAccessToken = jwt.sign(
        { id: decoded.id, email: decoded.email, role: decoded.role },
        config.jwt.secret,
        { expiresIn: config.jwt.expiresIn }
      );

      const newRefreshToken = jwt.sign(
        { id: decoded.id, type: 'refresh' },
        config.jwt.refreshSecret,
        { expiresIn: config.jwt.refreshExpiresIn }
      );

      res.json(successResponse({
        accessToken: newAccessToken,
        refreshToken: newRefreshToken
      }, 'Token refreshed successfully'));
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        next(new AppError('Invalid refresh token', 401, 'UNAUTHORIZED'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Validate access token
   */
  async validateToken(req, res, next) {
    try {
      // Token was already validated by middleware
      const user = req.user;

      res.json(successResponse({
        valid: true,
        user: {
          id: user.id,
          email: user.email,
          role: user.role
        }
      }, 'Token is valid'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * User logout
   */
  async logout(req, res, next) {
    try {
      const { refreshToken } = req.body;
      
      // In a real implementation, blacklist the refresh token
      // if (refreshToken) {
      //   await RefreshTokenModel.blacklist(refreshToken);
      // }

      logger.info('User logged out', { userId: req.userId });

      res.json(successResponse(null, 'Logout successful'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Forgot password
   */
  async forgotPassword(req, res, next) {
    try {
      const { email } = req.body;

      // In a real implementation, send password reset email
      // const user = await UserModel.findByEmail(email);
      // if (user) {
      //   const resetToken = crypto.randomBytes(32).toString('hex');
      //   await PasswordResetModel.create({ userId: user.id, token: resetToken });
      //   await EmailService.sendPasswordReset(email, resetToken);
      // }

      logger.info('Password reset requested', { email });

      res.json(successResponse(null, 'Password reset email sent if account exists'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reset password
   */
  async resetPassword(req, res, next) {
    try {
      const { token, newPassword } = req.body;

      // In a real implementation, validate reset token and update password
      // const resetRequest = await PasswordResetModel.findByToken(token);
      // if (!resetRequest || resetRequest.expiresAt < new Date()) {
      //   throw new AppError('Invalid or expired reset token', 400);
      // }
      // const passwordHash = await bcrypt.hash(newPassword, 10);
      // await UserModel.updatePassword(resetRequest.userId, passwordHash);
      // await PasswordResetModel.delete(resetRequest.id);

      res.json(successResponse(null, 'Password reset successful'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();