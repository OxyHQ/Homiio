/**
 * Horizon Integration Service
 * Handles integration with Horizon and other Oxy ecosystem apps
 */

const axios = require('axios');
const config = require('../config');
const { logger } = require('../middlewares/logging');
const { AppError } = require('../middlewares/errorHandler');

class HorizonService {
  constructor() {
    this.apiUrl = config.horizon.apiUrl;
    this.apiKey = config.horizon.apiKey;
  }

  /**
   * Sync user data with Horizon
   */
  async syncUserData(userId, userData) {
    try {
      const syncData = {
        userId: userId,
        source: 'homio',
        data: {
          profile: userData.profile,
          preferences: userData.preferences,
          properties: userData.properties || [],
          leases: userData.leases || [],
          lastSync: new Date().toISOString()
        }
      };

      const response = await axios.post(`${this.apiUrl}/sync/users`, syncData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('User data synced with Horizon', {
        userId: userId,
        syncId: response.data.syncId
      });

      return {
        syncId: response.data.syncId,
        status: response.data.status,
        timestamp: response.data.timestamp
      };
    } catch (error) {
      logger.error('Failed to sync user data with Horizon', {
        userId: userId,
        error: error.message
      });
      throw new AppError('Failed to sync with Horizon', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Sync property data with Horizon
   */
  async syncPropertyData(propertyId, propertyData) {
    try {
      const syncData = {
        propertyId: propertyId,
        source: 'homio',
        data: {
          property: propertyData,
          energyData: propertyData.energyData || null,
          occupancy: propertyData.occupancy || null,
          financials: propertyData.financials || null,
          lastSync: new Date().toISOString()
        }
      };

      const response = await axios.post(`${this.apiUrl}/sync/properties`, syncData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('Property data synced with Horizon', {
        propertyId: propertyId,
        syncId: response.data.syncId
      });

      return {
        syncId: response.data.syncId,
        status: response.data.status,
        timestamp: response.data.timestamp
      };
    } catch (error) {
      logger.error('Failed to sync property data with Horizon', {
        propertyId: propertyId,
        error: error.message
      });
      throw new AppError('Failed to sync property with Horizon', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Get market insights from Horizon
   */
  async getMarketInsights(location, propertyType) {
    try {
      const params = new URLSearchParams({
        location: location,
        propertyType: propertyType,
        source: 'homio'
      });

      const response = await axios.get(`${this.apiUrl}/insights/market?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        averageRent: response.data.averageRent,
        marketTrends: response.data.trends,
        pricePerSqft: response.data.pricePerSqft,
        occupancyRate: response.data.occupancyRate,
        recommendations: response.data.recommendations,
        lastUpdated: response.data.lastUpdated
      };
    } catch (error) {
      logger.error('Failed to get market insights from Horizon', {
        location: location,
        propertyType: propertyType,
        error: error.message
      });
      throw new AppError('Failed to get market insights', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Get energy efficiency recommendations
   */
  async getEnergyRecommendations(propertyId, energyData) {
    try {
      const requestData = {
        propertyId: propertyId,
        energyData: energyData,
        source: 'homio'
      };

      const response = await axios.post(`${this.apiUrl}/insights/energy`, requestData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      return {
        efficiencyRating: response.data.rating,
        recommendations: response.data.recommendations,
        potentialSavings: response.data.savings,
        upgrades: response.data.upgrades,
        carbonFootprint: response.data.carbonFootprint
      };
    } catch (error) {
      logger.error('Failed to get energy recommendations from Horizon', {
        propertyId: propertyId,
        error: error.message
      });
      throw new AppError('Failed to get energy recommendations', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Share property listing with Horizon network
   */
  async sharePropertyListing(propertyId, listingData) {
    try {
      const shareData = {
        propertyId: propertyId,
        listing: listingData,
        source: 'homio',
        visibility: 'public', // public, private, network
        features: [
          'faircoin_payments',
          'energy_monitoring',
          'smart_contracts'
        ]
      };

      const response = await axios.post(`${this.apiUrl}/listings`, shareData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('Property listing shared with Horizon', {
        propertyId: propertyId,
        listingId: response.data.listingId
      });

      return {
        listingId: response.data.listingId,
        status: response.data.status,
        views: response.data.views,
        shareUrl: response.data.shareUrl
      };
    } catch (error) {
      logger.error('Failed to share property listing with Horizon', {
        propertyId: propertyId,
        error: error.message
      });
      throw new AppError('Failed to share listing with Horizon', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Get connected Oxy apps
   */
  async getConnectedApps(userId) {
    try {
      const response = await axios.get(`${this.apiUrl}/users/${userId}/connected-apps`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data.apps.map(app => ({
        id: app.id,
        name: app.name,
        description: app.description,
        permissions: app.permissions,
        connected: app.connected,
        lastSync: app.lastSync
      }));
    } catch (error) {
      logger.error('Failed to get connected apps from Horizon', {
        userId: userId,
        error: error.message
      });
      throw new AppError('Failed to get connected apps', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Connect to another Oxy app
   */
  async connectToApp(userId, appId, permissions = []) {
    try {
      const connectionData = {
        userId: userId,
        appId: appId,
        permissions: permissions,
        source: 'homio'
      };

      const response = await axios.post(`${this.apiUrl}/connections`, connectionData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('Connected to Oxy app via Horizon', {
        userId: userId,
        appId: appId,
        connectionId: response.data.connectionId
      });

      return {
        connectionId: response.data.connectionId,
        status: response.data.status,
        permissions: response.data.permissions
      };
    } catch (error) {
      logger.error('Failed to connect to app via Horizon', {
        userId: userId,
        appId: appId,
        error: error.message
      });
      throw new AppError('Failed to connect to app', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Disconnect from an Oxy app
   */
  async disconnectFromApp(userId, appId) {
    try {
      await axios.delete(`${this.apiUrl}/users/${userId}/connections/${appId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      logger.info('Disconnected from Oxy app via Horizon', {
        userId: userId,
        appId: appId
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to disconnect from app via Horizon', {
        userId: userId,
        appId: appId,
        error: error.message
      });
      throw new AppError('Failed to disconnect from app', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Get cross-app notifications
   */
  async getCrossAppNotifications(userId) {
    try {
      const response = await axios.get(`${this.apiUrl}/users/${userId}/notifications`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return response.data.notifications.map(notification => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        app: notification.app,
        priority: notification.priority,
        read: notification.read,
        createdAt: notification.createdAt,
        data: notification.data
      }));
    } catch (error) {
      logger.error('Failed to get cross-app notifications from Horizon', {
        userId: userId,
        error: error.message
      });
      throw new AppError('Failed to get notifications', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Send cross-app notification
   */
  async sendCrossAppNotification(notification) {
    try {
      const notificationData = {
        ...notification,
        source: 'homio',
        timestamp: new Date().toISOString()
      };

      const response = await axios.post(`${this.apiUrl}/notifications`, notificationData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('Cross-app notification sent via Horizon', {
        notificationId: response.data.notificationId,
        recipientId: notification.recipientId
      });

      return {
        notificationId: response.data.notificationId,
        status: response.data.status
      };
    } catch (error) {
      logger.error('Failed to send cross-app notification via Horizon', {
        notification: notification,
        error: error.message
      });
      throw new AppError('Failed to send notification', 500, 'HORIZON_ERROR');
    }
  }

  /**
   * Get ecosystem analytics
   */
  async getEcosystemAnalytics(userId, timeframe = '30d') {
    try {
      const params = new URLSearchParams({
        timeframe: timeframe,
        source: 'homio'
      });

      const response = await axios.get(`${this.apiUrl}/users/${userId}/analytics?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        totalInteractions: response.data.totalInteractions,
        appsUsed: response.data.appsUsed,
        crossAppActions: response.data.crossAppActions,
        dataShared: response.data.dataShared,
        insights: response.data.insights,
        trends: response.data.trends
      };
    } catch (error) {
      logger.error('Failed to get ecosystem analytics from Horizon', {
        userId: userId,
        timeframe: timeframe,
        error: error.message
      });
      throw new AppError('Failed to get ecosystem analytics', 500, 'HORIZON_ERROR');
    }
  }
}

module.exports = new HorizonService();
