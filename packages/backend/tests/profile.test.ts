import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';
const { Profile } = require('../models');
const profileRoutes = require('../routes/profiles');

// Mock the OxyHQ services authentication middleware
const mockAuthMiddleware = (req: any, res: any, next: any) => {
  req.user = {
    id: 'test-user-123',
    _id: 'test-user-123',
    email: 'test@example.com'
  };
  next();
};

// Create test app
const createTestApp = () => {
  const app = express();
  app.use(bodyParser.json());
  app.use(mockAuthMiddleware);
  app.use('/api/profiles', profileRoutes());
  
  // Error handler
  app.use((error: any, req: any, res: any, next: any) => {
    res.status(error.status || 500).json({
      success: false,
      message: error.message || 'Internal server error',
      code: error.code || 'ERROR'
    });
  });
  
  return app;
};

describe('Profile Controller Tests', () => {
  let app: express.Application;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('GET /api/profiles/ - Profile Auto-Creation', () => {
    it('should create a default personal profile when no profile exists', async () => {
      const response = await request(app)
        .get('/api/profiles/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.profileType).toBe('personal');
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.isPrimary).toBe(true);
      expect(response.body.data.oxyUserId).toBe('test-user-123');

      // Verify profile was saved to database
      const savedProfile = await Profile.findOne({ oxyUserId: 'test-user-123' });
      expect(savedProfile).toBeTruthy();
      expect(savedProfile.profileType).toBe('personal');
    });

    it('should return existing active profile if one exists', async () => {
      // Create a profile first
      const existingProfile = await Profile.create({
        oxyUserId: 'test-user-123',
        profileType: 'personal',
        isActive: true,
        isPrimary: true,
        personalProfile: {
          personalInfo: {
            bio: 'Existing bio',
            occupation: 'Developer',
            employmentStatus: 'employed'
          }
        }
      });

      const response = await request(app)
        .get('/api/profiles/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.personalProfile.personalInfo.bio).toBe('Existing bio');
      expect(response.body.data.personalProfile.personalInfo.occupation).toBe('Developer');
    });

    it('should activate existing personal profile if not active', async () => {
      // Create an inactive personal profile
      await Profile.create({
        oxyUserId: 'test-user-123',
        profileType: 'personal',
        isActive: false,
        isPrimary: true,
        personalProfile: {
          personalInfo: {
            bio: 'Inactive profile',
            employmentStatus: 'employed'
          }
        }
      });

      const response = await request(app)
        .get('/api/profiles/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.personalProfile.personalInfo.bio).toBe('Inactive profile');

      // Verify profile was updated in database
      const updatedProfile = await Profile.findOne({ oxyUserId: 'test-user-123' });
      expect(updatedProfile.isActive).toBe(true);
    });

    it('should handle unauthenticated requests', async () => {
      const appWithoutAuth = express();
      appWithoutAuth.use(bodyParser.json());
      appWithoutAuth.use('/api/profiles', profileRoutes());
      
      appWithoutAuth.use((error: any, req: any, res: any, next: any) => {
        res.status(error.status || 500).json({
          success: false,
          message: error.message || 'Internal server error',
          code: error.code || 'ERROR'
        });
      });

      const response = await request(appWithoutAuth)
        .get('/api/profiles/')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });
  });

  describe('GET /api/profiles/me - Profile Auto-Creation via /me endpoint', () => {
    it('should create a default personal profile via /me endpoint', async () => {
      const response = await request(app)
        .get('/api/profiles/me')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.profileType).toBe('personal');
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.personalProfile).toBeDefined();
      
      // Check default values are set correctly
      expect(response.body.data.personalProfile.personalInfo).toBeDefined();
      expect(response.body.data.personalProfile.preferences).toBeDefined();
      expect(response.body.data.personalProfile.trustScore.score).toBe(50);
    });
  });

  describe('POST /api/profiles/ - Manual Profile Creation', () => {
    it('should create a new profile with provided data', async () => {
      const profileData = {
        profileType: 'personal',
        personalProfile: {
          personalInfo: {
            bio: 'Test bio',
            occupation: 'Software Engineer',
            employer: 'Tech Corp',
            annualIncome: 75000,
            employmentStatus: 'employed'
          },
          preferences: {
            maxRent: 2000,
            minBedrooms: 2
          }
        }
      };

      const response = await request(app)
        .post('/api/profiles/')
        .send(profileData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.personalProfile.personalInfo.bio).toBe('Test bio');
      expect(response.body.data.personalProfile.personalInfo.occupation).toBe('Software Engineer');
      expect(response.body.data.personalProfile.preferences.maxRent).toBe(2000);
    });
  });

  describe('GET /api/profiles/me/all - Get All User Profiles', () => {
    it('should return all profiles for a user', async () => {
      // Create multiple profiles
      await Profile.create({
        oxyUserId: 'test-user-123',
        profileType: 'personal',
        isActive: true,
        isPrimary: true
      });

      await Profile.create({
        oxyUserId: 'test-user-123',
        profileType: 'business',
        isActive: false,
        isPrimary: false
      });

      const response = await request(app)
        .get('/api/profiles/me/all')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.data.some((p: any) => p.profileType === 'personal')).toBe(true);
      expect(response.body.data.some((p: any) => p.profileType === 'business')).toBe(true);
    });

    it('should return empty array when no profiles exist', async () => {
      const response = await request(app)
        .get('/api/profiles/me/all')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveLength(0);
    });
  });

  describe('Profile Trust Score Calculation', () => {
    it('should calculate trust score when creating a default profile', async () => {
      const response = await request(app)
        .get('/api/profiles/')
        .expect(200);

      expect(response.body.data.personalProfile.trustScore).toBeDefined();
      expect(response.body.data.personalProfile.trustScore.score).toBeGreaterThanOrEqual(0);
      expect(response.body.data.personalProfile.trustScore.score).toBeLessThanOrEqual(100);
      expect(response.body.data.personalProfile.trustScore.factors).toBeDefined();
    });
  });
});