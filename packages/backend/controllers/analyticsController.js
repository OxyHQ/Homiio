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
      const data = await horizonService.getEcosystemAnalytics(userId, period);
      res.json(successResponse(data, 'Analytics retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AnalyticsController();
