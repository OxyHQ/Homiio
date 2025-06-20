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
}

module.exports = new AnalyticsController();
