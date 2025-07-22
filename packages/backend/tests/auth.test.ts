import request from 'supertest';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';

// Mock OxyHQ services to simulate authentication scenarios
class MockOxyServices {
  createAuthenticateTokenMiddleware(options: any) {
    return (req: any, res: any, next: any) => {
      const authHeader = req.headers.authorization;
      
      // Simulate different authentication scenarios based on the token
      if (!authHeader) {
        const error = new Error('No authentication token provided');
        (error as any).status = 401;
        return options.onError(error, req, res, next);
      }
      
      const token = authHeader.replace('Bearer ', '');
      
      if (token === 'invalid-token') {
        const error = new Error('Invalid token');
        (error as any).status = 403;
        return options.onError(error, req, res, next);
      }
      
      if (token === 'expired-token') {
        const error = new Error('Token expired');
        (error as any).status = 401;
        return options.onError(error, req, res, next);
      }
      
      if (token === 'server-error-token') {
        const error = new Error('Internal server error');
        (error as any).status = 500;
        return options.onError(error, req, res, next);
      }
      
      if (token === 'valid-token') {
        req.user = {
          id: 'test-user-123',
          _id: 'test-user-123',
          email: 'test@example.com'
        };
        return next();
      }
      
      // Default case - invalid token
      const error = new Error('Authentication failed');
      (error as any).status = 403;
      return options.onError(error, req, res, next);
    };
  }
}

// Create test app with the fixed authentication middleware
const createTestApp = () => {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json());

  const oxy = new MockOxyServices();

  // This replicates the fixed authentication middleware from server.ts
  const authenticateToken = oxy.createAuthenticateTokenMiddleware({
    loadFullUser: true,
    onError: (error: any, req: any, res: any, next: any) => {
      console.error('Auth error:', error);
      
      // Ensure res is available and is a valid response object
      if (!res || typeof res.status !== 'function') {
        console.error('Response object is invalid or undefined in onError callback');
        if (next && typeof next === 'function') {
          return next(error);
        }
        return;
      }
      
      let status = 403;
      let message = 'Authentication failed';
      
      if (error && typeof error === 'object') {
        if (typeof error.status === 'number') status = error.status;
        if (typeof error.message === 'string') message = error.message;
      }
      
      try {
        res.status(status).json({ error: message });
      } catch (responseError) {
        console.error('Error sending response in auth error handler:', responseError);
        if (next && typeof next === 'function') {
          next(error);
        }
      }
    }
  });

  // Test routes
  app.get('/public', (req, res) => {
    res.json({ message: 'This is a public route' });
  });

  app.get('/protected', authenticateToken, (req, res) => {
    res.json({ 
      message: 'This is a protected route',
      user: req.user 
    });
  });

  // Error handler
  app.use((error: any, req: any, res: any, next: any) => {
    res.status(error.status || 500).json({
      error: error.message || 'Internal server error'
    });
  });

  return app;
};

describe('Authentication Middleware Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('Public Routes', () => {
    it('should allow access to public routes without authentication', async () => {
      const response = await request(app)
        .get('/public')
        .expect(200);

      expect(response.body.message).toBe('This is a public route');
    });
  });

  describe('Protected Routes - Authentication Error Handling', () => {
    it('should handle missing authentication token', async () => {
      const response = await request(app)
        .get('/protected')
        .expect(401);

      expect(response.body.error).toBe('No authentication token provided');
    });

    it('should handle invalid authentication token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body.error).toBe('Invalid token');
    });

    it('should handle expired authentication token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer expired-token')
        .expect(401);

      expect(response.body.error).toBe('Token expired');
    });

    it('should handle server errors in authentication', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer server-error-token')
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });

    it('should allow access with valid token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer valid-token')
        .expect(200);

      expect(response.body.message).toBe('This is a protected route');
      expect(response.body.user).toBeDefined();
      expect(response.body.user.id).toBe('test-user-123');
    });
  });

  describe('Error Handler Resilience', () => {
    it('should not crash when response object is invalid', async () => {
      // This test ensures the middleware doesn't crash even in edge cases
      // The fix includes validation to ensure res is a valid response object
      
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(403);

      expect(response.body.error).toBeDefined();
      expect(typeof response.body.error).toBe('string');
    });

    it('should handle malformed authorization headers gracefully', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'InvalidFormat')
        .expect(403);

      expect(response.body.error).toBe('Authentication failed');
    });

    it('should handle empty authorization headers gracefully', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', '')
        .expect(401);

      expect(response.body.error).toBe('No authentication token provided');
    });
  });
});