/**
 * Public Routes (No Authentication Required)
 * These routes can be accessed without authentication
 */

const express = require('express');
const propertyController = require('../controllers/propertyController');
const telegramController = require('../controllers/telegramController');
const cityController = require('../controllers/cityController').default;
const tipsController = require('../controllers/tipsController');
const analyticsController = require('../controllers/analyticsController');
const geocodingController = require('../controllers/geocodingController').default;
const { asyncHandler } = require('../middlewares');
const performanceMonitor = require('../middlewares/performance').default;
const Conversation = require('../models/schemas/ConversationSchema');

export default function () {
  const router = express.Router();

  // Performance monitoring for all routes
  router.use(performanceMonitor);

  // Public property routes
  router.get('/properties', asyncHandler(propertyController.getProperties));
  router.get('/properties/search', asyncHandler(propertyController.searchProperties));
  router.get('/properties/by-ids', asyncHandler(propertyController.getPropertiesByIds));
  router.get('/properties/nearby', asyncHandler(propertyController.findNearbyProperties));
  router.get('/properties/radius', asyncHandler(propertyController.findPropertiesInRadius));
  router.get('/properties/:propertyId', asyncHandler(propertyController.getPropertyById));
  router.get('/properties/:propertyId/stats', asyncHandler(propertyController.getPropertyStats));

  // Public geocoding routes
  router.get('/geocoding/reverse', asyncHandler(geocodingController.reverseGeocode));
  router.get('/geocoding/forward', asyncHandler(geocodingController.forwardGeocode));

  // Public city routes
  router.get('/cities', asyncHandler(cityController.getCities));
  router.get('/cities/popular', asyncHandler(cityController.getPopularCities));
  router.get('/cities/search', asyncHandler(cityController.searchCities));
  router.get('/cities/lookup', asyncHandler(cityController.getCityByLocation));
  router.get('/cities/:id', asyncHandler(cityController.getCityById));
  router.get('/cities/:id/properties', asyncHandler(cityController.getPropertiesByCity));

  // Public tips routes
  router.get('/tips', asyncHandler(tipsController.getAllTips));
  router.get('/tips/featured', asyncHandler(tipsController.getFeaturedTips));
  // Public analytics/stats (no auth)
  router.get('/analytics/stats', asyncHandler(analyticsController.getAppStats));
  router.get('/tips/category/:category', asyncHandler(tipsController.getTipsByCategory));
  router.get('/tips/search', asyncHandler(tipsController.searchTips));
  router.get('/tips/:id', asyncHandler(tipsController.getTipById));

  // Ethical pricing calculation endpoint (public - no authentication required)
  router.post('/properties/calculate-ethical-pricing', asyncHandler(async (req, res) => {
    const { localMedianIncome, areaAverageRent, propertyType, bedrooms, bathrooms, squareFootage } = req.body;

    // Validate required fields
    if (!localMedianIncome || !areaAverageRent) {
      return res.status(400).json({
        success: false,
        message: 'Local median income and area average rent are required'
      });
    }

    if (localMedianIncome <= 0 || areaAverageRent <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Income and rent values must be positive numbers'
      });
    }

    // Calculate monthly income
    const monthlyMedianIncome = localMedianIncome / 12;
    
    // Adjust percentages based on income level - lower incomes need higher housing percentages
    let standardRentPercentage, affordableRentPercentage, communityRentPercentage;
    
    if (monthlyMedianIncome < 2000) {
      // Lower income: higher percentage needed for housing
      standardRentPercentage = 0.65; // 65% for very low income
      affordableRentPercentage = 0.55; // 55% for affordable
      communityRentPercentage = 0.45; // 45% for community
    } else if (monthlyMedianIncome < 4000) {
      // Moderate income
      standardRentPercentage = 0.5; // 50%
      affordableRentPercentage = 0.4; // 40%
      communityRentPercentage = 0.35; // 35%
    } else if (monthlyMedianIncome < 8000) {
      // Higher income
      standardRentPercentage = 0.4; // 40%
      affordableRentPercentage = 0.35; // 35%
      communityRentPercentage = 0.3; // 30%
    } else {
      // High income: can afford lower percentages
      standardRentPercentage = 0.35; // 35%
      affordableRentPercentage = 0.3; // 30%
      communityRentPercentage = 0.25; // 25%
    }

    // Calculate ethical pricing suggestions
    const suggestions = {
      standardRent: Math.round(monthlyMedianIncome * standardRentPercentage),
      affordableRent: Math.round(monthlyMedianIncome * affordableRentPercentage),
      marketRate: areaAverageRent,
      reducedDeposit: Math.round(monthlyMedianIncome * standardRentPercentage),
      communityRent: Math.round(monthlyMedianIncome * communityRentPercentage),
      slidingScaleBase: Math.round(monthlyMedianIncome * (communityRentPercentage - 0.1)),
      slidingScaleMax: Math.round(monthlyMedianIncome * (standardRentPercentage + 0.1)),
      marketAdjustedRent: Math.round(Math.min(areaAverageRent * 0.9, monthlyMedianIncome * 0.7)),
      incomeBasedRent: Math.round(monthlyMedianIncome * 0.7),
    };

    // Validate suggestions against market rate
    const isMarketRateReasonable = areaAverageRent >= suggestions.affordableRent * 0.7 && 
                                  areaAverageRent <= suggestions.standardRent * 2.0;

    // Provide market context
    const rentToIncomeRatio = (areaAverageRent / monthlyMedianIncome) * 100;
    let marketContext = '';
    
    if (rentToIncomeRatio < 25) {
      marketContext = 'Very affordable market';
    } else if (rentToIncomeRatio < 35) {
      marketContext = 'Affordable market';
    } else if (rentToIncomeRatio < 45) {
      marketContext = 'Moderate market';
    } else if (rentToIncomeRatio < 55) {
      marketContext = 'Expensive market';
    } else {
      marketContext = 'Very expensive market';
    }

    // Generate warnings if needed
    const warnings = [];
    if (!isMarketRateReasonable) {
      if (areaAverageRent < suggestions.affordableRent * 0.7) {
        warnings.push('Market rate seems unusually low compared to local income');
      } else {
        warnings.push('Market rate seems unusually high compared to local income');
      }
    }

    // Add property-specific adjustments
    const propertyAdjustments = {
      studio: 0.8, // Studios typically cost less
      room: 0.6,   // Rooms cost significantly less
      apartment: 1.0, // Base rate
      house: 1.2,  // Houses typically cost more
    };

    const adjustmentFactor = propertyAdjustments[propertyType] || 1.0;
    const adjustedSuggestions = {};

    // Apply property type adjustments to relevant suggestions
    Object.keys(suggestions).forEach(key => {
      if (key !== 'marketRate' && key !== 'reducedDeposit') {
        adjustedSuggestions[key] = Math.round(suggestions[key] * adjustmentFactor);
      } else {
        adjustedSuggestions[key] = suggestions[key];
      }
    });

    res.json({
      success: true,
      data: {
        suggestions: adjustedSuggestions,
        marketContext,
        warnings,
        calculations: {
          monthlyMedianIncome,
          rentToIncomeRatio: Math.round(rentToIncomeRatio * 100) / 100,
          standardRentPercentage: Math.round(standardRentPercentage * 100),
          affordableRentPercentage: Math.round(affordableRentPercentage * 100),
          communityRentPercentage: Math.round(communityRentPercentage * 100),
        }
      }
    });
  }));

  // Public Telegram routes (for testing and bot management)
  router.get('/telegram/status', asyncHandler(telegramController.getBotStatus));
  router.get('/telegram/groups/:city', asyncHandler(telegramController.getGroupMapping));
  router.get('/telegram/webhook', asyncHandler(telegramController.getWebhookInfo));
  router.post('/telegram/test', asyncHandler(telegramController.sendTestMessage));

  // Public profile route (read-only)
  const profileController = require('../controllers/profileController');
  router.get('/public/profiles/:profileId', asyncHandler(profileController.getProfileById));

  // Public shared conversation endpoint (no authentication required)
  router.get('/ai/shared/:token', asyncHandler(async (req, res) => {
    try {
      const conversation = await Conversation.findByShareToken(req.params.token);
      
      if (!conversation) {
        return res.status(404).json({ error: 'Shared conversation not found or expired' });
      }

      // Return conversation without sensitive user data, including status field
      const sharedConversation = {
        _id: conversation._id,
        title: conversation.title,
        messages: conversation.messages,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        status: conversation.status || 'active'
      };

      res.json({ success: true, conversation: sharedConversation });
    } catch (error) {
      console.error('Failed to get shared conversation:', error);
      res.status(500).json({ error: 'Failed to get shared conversation' });
    }
  }));

  return router;
}; 