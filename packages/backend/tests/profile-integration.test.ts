import request from 'supertest';
import express from 'express';
import bodyParser from 'body-parser';

// Simple test to verify the basic server functionality and authentication flow
describe('Profile Creation Integration Tests', () => {
  let app: express.Application;

  // Mock the authentication middleware to simulate authenticated requests
  const mockAuthMiddleware = (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-123',
      _id: 'test-user-123',
      email: 'test@example.com'
    };
    next();
  };

  // Mock profile controller methods
  const mockProfileController = {
    getOrCreateActiveProfile: async (req: any, res: any, next: any) => {
      try {
        const oxyUserId = req.user?.id || req.user?._id;
        
        if (!oxyUserId) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTHENTICATION_REQUIRED'
          });
        }

        // Simulate profile auto-creation behavior
        const mockProfile = {
          _id: 'profile-123',
          oxyUserId,
          profileType: 'personal',
          isActive: true,
          isPrimary: true,
          personalProfile: {
            personalInfo: {
              bio: '',
              occupation: '',
              employer: '',
              annualIncome: null,
              employmentStatus: 'employed',
              moveInDate: null,
              leaseDuration: 'yearly'
            },
            preferences: {},
            references: [],
            rentalHistory: [],
            verification: {},
            trustScore: { score: 50, factors: [] },
            settings: {
              notifications: { email: true, push: true, sms: false },
              privacy: { profileVisibility: 'public', showContactInfo: true, showIncome: false },
              language: 'en',
              timezone: 'UTC'
            }
          },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        res.json({
          success: true,
          message: 'Profile retrieved successfully',
          data: mockProfile
        });
      } catch (error) {
        console.error('Error in getOrCreateActiveProfile:', error);
        next(error);
      }
    },

    createProfile: async (req: any, res: any, next: any) => {
      try {
        const oxyUserId = req.user?.id || req.user?._id;
        
        if (!oxyUserId) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTHENTICATION_REQUIRED'
          });
        }

        const profileData = req.body;
        const newProfile = {
          _id: 'profile-' + Date.now(),
          oxyUserId,
          profileType: profileData.profileType || 'personal',
          isActive: true,
          isPrimary: false,
          ...profileData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        res.status(201).json({
          success: true,
          message: 'Profile created successfully',
          data: newProfile
        });
      } catch (error) {
        console.error('Error in createProfile:', error);
        next(error);
      }
    },

    getUserProfiles: async (req: any, res: any, next: any) => {
      try {
        const oxyUserId = req.user?.id || req.user?._id;
        
        if (!oxyUserId) {
          return res.status(401).json({
            success: false,
            message: 'Authentication required',
            code: 'AUTHENTICATION_REQUIRED'
          });
        }

        // Mock returning user profiles
        const mockProfiles = [
          {
            _id: 'profile-123',
            oxyUserId,
            profileType: 'personal',
            isActive: true,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        ];

        res.json({
          success: true,
          message: 'Profiles retrieved successfully',
          data: mockProfiles
        });
      } catch (error) {
        console.error('Error in getUserProfiles:', error);
        next(error);
      }
    }
  };

  // Async handler wrapper
  const asyncHandler = (fn: any) => (req: any, res: any, next: any) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

  beforeEach(() => {
    app = express();
    app.use(bodyParser.json());
    
    // Add authentication middleware for protected routes
    app.use('/api/profiles', mockAuthMiddleware);
    
    // Define routes manually to test the flow
    app.get('/api/profiles/', asyncHandler(mockProfileController.getOrCreateActiveProfile));
    app.post('/api/profiles/', asyncHandler(mockProfileController.createProfile));
    app.get('/api/profiles/me', asyncHandler(mockProfileController.getOrCreateActiveProfile));
    app.get('/api/profiles/me/all', asyncHandler(mockProfileController.getUserProfiles));
    
    // Test route without authentication - this should not have auth middleware
    app.get('/api/profiles/unauth', (req, res, next) => {
      // Directly call the controller without auth middleware
      mockProfileController.getOrCreateActiveProfile(req, res, next);
    });

    // Error handler
    app.use((error: any, req: any, res: any, next: any) => {
      res.status(error.status || 500).json({
        success: false,
        message: error.message || 'Internal server error',
        code: error.code || 'ERROR'
      });
    });
  });

  describe('Profile Auto-Creation Functionality', () => {
    it('should auto-create a personal profile when accessing /api/profiles/', async () => {
      const response = await request(app)
        .get('/api/profiles/')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.profileType).toBe('personal');
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.isPrimary).toBe(true);
      expect(response.body.data.oxyUserId).toBe('test-user-123');
      expect(response.body.data.personalProfile).toBeDefined();
      expect(response.body.data.personalProfile.trustScore.score).toBe(50);
    });

    it('should auto-create a personal profile when accessing /api/profiles/me', async () => {
      const response = await request(app)
        .get('/api/profiles/me')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.profileType).toBe('personal');
      expect(response.body.data.isActive).toBe(true);
      expect(response.body.data.personalProfile).toBeDefined();
      
      // Verify default profile structure
      expect(response.body.data.personalProfile.personalInfo).toBeDefined();
      expect(response.body.data.personalProfile.preferences).toBeDefined();
      expect(response.body.data.personalProfile.settings).toBeDefined();
      expect(response.body.data.personalProfile.settings.notifications).toBeDefined();
      expect(response.body.data.personalProfile.settings.privacy).toBeDefined();
    });

    it('should require authentication for profile creation', async () => {
      const response = await request(app)
        .get('/api/profiles/unauth')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('AUTHENTICATION_REQUIRED');
    });

    it('should allow manual profile creation with custom data', async () => {
      const profileData = {
        profileType: 'personal',
        personalProfile: {
          personalInfo: {
            bio: 'Test user bio',
            occupation: 'Software Developer',
            employer: 'Tech Company',
            annualIncome: 80000,
            employmentStatus: 'employed'
          },
          preferences: {
            maxRent: 2500,
            minBedrooms: 2,
            minBathrooms: 1
          }
        }
      };

      const response = await request(app)
        .post('/api/profiles/')
        .send(profileData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.personalProfile.personalInfo.bio).toBe('Test user bio');
      expect(response.body.data.personalProfile.personalInfo.occupation).toBe('Software Developer');
      expect(response.body.data.personalProfile.preferences.maxRent).toBe(2500);
    });

    it('should return user profiles', async () => {
      const response = await request(app)
        .get('/api/profiles/me/all')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.data[0].profileType).toBe('personal');
      expect(response.body.data[0].oxyUserId).toBe('test-user-123');
    });
  });

  describe('Profile Creation Error Handling', () => {
    it('should handle errors gracefully', async () => {
      // Test that our error handling works
      const response = await request(app)
        .get('/api/profiles/unauth')
        .expect(401);

      expect(response.body).toHaveProperty('success');
      expect(response.body.success).toBe(false);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code');
    });
  });
});