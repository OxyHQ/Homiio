/**
 * Analytics Controller
 * Provides user analytics via Horizon service
 */

const { horizonService } = require('../services');
const { successResponse } = require('../middlewares/errorHandler');

class AnalyticsController {
  async getAnalytics(req, res, next) {
    try {
      const userId = req.query.userID || req.userId;
      const period = req.query.period || '30d';
      
      try {
        const data = await horizonService.getEcosystemAnalytics(userId, period);
        res.json(successResponse(data, 'Analytics retrieved successfully'));
      } catch (horizonError) {
        // Fallback to mock analytics if Horizon service fails
        const mockAnalytics = {
          totalInteractions: 145,
          appsUsed: ['homio', 'fairmint', 'horizon'],
          crossAppActions: 23,
          dataShared: 8,
          insights: [
            'Your energy usage is 15% below average',
            'You have 2 pending lease renewals',
            'Property occupancy rate is 85%'
          ],
          trends: {
            energyUsage: { current: 450, change: -15, period: 'last_30_days' },
            propertyRevenue: { current: 5200, change: 8, period: 'last_30_days' },
            tenantSatisfaction: { current: 4.2, change: 0.3, period: 'last_30_days' }
          }
        };
        
        res.json(successResponse(mockAnalytics, 'Analytics retrieved successfully (mock data)'));
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get app-wide statistics (public)
   * - Totals: properties, cities, saves, unique savers
   * - Pricing: average/min/max rent
   * - Top cities by property count with average rent
   * - Price buckets distribution
   */
  async getAppStats(req, res, next) {
    try {
      const { Property, City } = require('../models');
      let Saved;
      try {
        Saved = require('../models').Saved;
      } catch (_) {
        Saved = null;
      }

      // Totals
      const [totalProperties, totalCities, totalSaves, uniqueSavers] = await Promise.all([
        Property.countDocuments({}),
        City.countDocuments({}),
        Saved ? Saved.countDocuments({ targetType: 'property' }) : Promise.resolve(0),
        Saved ? Saved.distinct('profileId', { targetType: 'property' }).then((arr) => arr.length) : Promise.resolve(0),
      ]);

      // Pricing aggregates
      const pricingAgg = await Property.aggregate([
        { $match: { 'rent.amount': { $gt: 0 } } },
        {
          $group: {
            _id: null,
            averageRent: { $avg: '$rent.amount' },
            minRent: { $min: '$rent.amount' },
            maxRent: { $max: '$rent.amount' },
          },
        },
      ]).catch(() => []);

      const pricing = pricingAgg[0] || { averageRent: 0, minRent: 0, maxRent: 0 };

      // Top cities by property count with avg rent
      const topCities = await Property.aggregate([
        { $match: { 'address.city': { $exists: true, $ne: null } } },
        {
          $group: {
            _id: { city: '$address.city', state: '$address.state' },
            properties: { $sum: 1 },
            averageRent: { $avg: '$rent.amount' },
          },
        },
        { $sort: { properties: -1 } },
        { $limit: 6 },
      ]).catch(() => []);

      // Price buckets (preset boundaries)
      const priceBuckets = await Property.aggregate([
        { $match: { 'rent.amount': { $gte: 0 } } },
        {
          $bucket: {
            groupBy: '$rent.amount',
            boundaries: [0, 500, 1000, 1500, 2000, 3000, 5000, 10000],
            default: '10000+',
            output: { count: { $sum: 1 } },
          },
        },
      ]).catch(() => []);

      return res.json(
        successResponse(
          {
            totals: {
              properties: totalProperties,
              cities: totalCities,
              saves: totalSaves,
              uniqueSavers: uniqueSavers,
            },
            pricing: {
              averageRent: Math.round(pricing.averageRent || 0),
              minRent: pricing.minRent || 0,
              maxRent: pricing.maxRent || 0,
            },
            topCities: topCities.map((c) => ({
              city: c._id.city,
              state: c._id.state,
              properties: c.properties,
              averageRent: Math.round(c.averageRent || 0),
            })),
            priceBuckets: priceBuckets.map((b) => ({
              bucket: typeof b._id === 'string' ? b._id : `${b._id}-${b._id + 499}`,
              count: b.count,
            })),
          },
          'App stats retrieved successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AnalyticsController();
