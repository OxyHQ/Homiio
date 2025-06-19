/**
 * FairCoin Service
 * Handles FairCoin blockchain integration for rent payments
 */

const axios = require('axios');
const config = require('../config');
const { logger } = require('../middlewares/logging');
const { AppError } = require('../middlewares/errorHandler');

class FairCoinService {
  constructor() {
    this.apiUrl = config.fairCoin.apiUrl;
    this.apiKey = config.fairCoin.apiKey;
    this.webhookSecret = config.fairCoin.webhookSecret;
  }

  /**
   * Initialize FairCoin wallet for a user
   */
  async createWallet(userId) {
    try {
      const response = await axios.post(`${this.apiUrl}/wallets`, {
        userId: userId,
        type: 'rental'
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('FairCoin wallet created', {
        userId: userId,
        walletAddress: response.data.address
      });

      return {
        address: response.data.address,
        publicKey: response.data.publicKey,
        balance: 0
      };
    } catch (error) {
      logger.error('Failed to create FairCoin wallet', {
        userId: userId,
        error: error.message
      });
      throw new AppError('Failed to create FairCoin wallet', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Get wallet balance
   */
  async getWalletBalance(walletAddress) {
    try {
      const response = await axios.get(`${this.apiUrl}/wallets/${walletAddress}/balance`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        balance: response.data.balance,
        currency: 'FAIR',
        usdValue: response.data.usdValue
      };
    } catch (error) {
      logger.error('Failed to get wallet balance', {
        walletAddress: walletAddress,
        error: error.message
      });
      throw new AppError('Failed to get wallet balance', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Create a rent payment transaction
   */
  async createRentPayment(paymentData) {
    try {
      const {
        fromWallet,
        toWallet,
        amount,
        leaseId,
        tenantId,
        landlordId,
        description
      } = paymentData;

      const transactionData = {
        from: fromWallet,
        to: toWallet,
        amount: amount,
        currency: 'FAIR',
        metadata: {
          type: 'rent_payment',
          leaseId: leaseId,
          tenantId: tenantId,
          landlordId: landlordId,
          description: description
        }
      };

      const response = await axios.post(`${this.apiUrl}/transactions`, transactionData, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('FairCoin rent payment created', {
        transactionHash: response.data.hash,
        leaseId: leaseId,
        amount: amount,
        from: fromWallet,
        to: toWallet
      });

      return {
        transactionHash: response.data.hash,
        status: response.data.status,
        confirmations: response.data.confirmations,
        gasUsed: response.data.gasUsed,
        timestamp: response.data.timestamp
      };
    } catch (error) {
      logger.error('Failed to create rent payment', {
        error: error.message,
        paymentData: paymentData
      });
      throw new AppError('Failed to create rent payment', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Get transaction status
   */
  async getTransactionStatus(transactionHash) {
    try {
      const response = await axios.get(`${this.apiUrl}/transactions/${transactionHash}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        hash: response.data.hash,
        status: response.data.status,
        confirmations: response.data.confirmations,
        blockNumber: response.data.blockNumber,
        gasUsed: response.data.gasUsed,
        timestamp: response.data.timestamp,
        from: response.data.from,
        to: response.data.to,
        amount: response.data.amount
      };
    } catch (error) {
      logger.error('Failed to get transaction status', {
        transactionHash: transactionHash,
        error: error.message
      });
      throw new AppError('Failed to get transaction status', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Set up automatic rent payments
   */
  async setupAutoPayment(autoPaymentData) {
    try {
      const {
        fromWallet,
        toWallet,
        amount,
        frequency, // monthly, weekly
        startDate,
        leaseId,
        tenantId
      } = autoPaymentData;

      const response = await axios.post(`${this.apiUrl}/auto-payments`, {
        fromWallet: fromWallet,
        toWallet: toWallet,
        amount: amount,
        frequency: frequency,
        startDate: startDate,
        metadata: {
          type: 'auto_rent',
          leaseId: leaseId,
          tenantId: tenantId
        }
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      logger.info('Auto payment setup created', {
        autoPaymentId: response.data.id,
        leaseId: leaseId,
        tenantId: tenantId
      });

      return {
        id: response.data.id,
        status: response.data.status,
        nextPaymentDate: response.data.nextPaymentDate
      };
    } catch (error) {
      logger.error('Failed to setup auto payment', {
        error: error.message,
        autoPaymentData: autoPaymentData
      });
      throw new AppError('Failed to setup auto payment', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Cancel automatic payments
   */
  async cancelAutoPayment(autoPaymentId) {
    try {
      await axios.delete(`${this.apiUrl}/auto-payments/${autoPaymentId}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      logger.info('Auto payment cancelled', {
        autoPaymentId: autoPaymentId
      });

      return { success: true };
    } catch (error) {
      logger.error('Failed to cancel auto payment', {
        autoPaymentId: autoPaymentId,
        error: error.message
      });
      throw new AppError('Failed to cancel auto payment', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Get transaction history for a wallet
   */
  async getTransactionHistory(walletAddress, options = {}) {
    try {
      const { page = 1, limit = 20, type = null } = options;
      
      const params = new URLSearchParams({
        page: page.toString(),
        limit: limit.toString()
      });
      
      if (type) params.append('type', type);

      const response = await axios.get(`${this.apiUrl}/wallets/${walletAddress}/transactions?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      return {
        transactions: response.data.transactions,
        pagination: response.data.pagination
      };
    } catch (error) {
      logger.error('Failed to get transaction history', {
        walletAddress: walletAddress,
        error: error.message
      });
      throw new AppError('Failed to get transaction history', 500, 'FAIRCOIN_ERROR');
    }
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(payload, signature) {
    const crypto = require('crypto');
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');
    
    return signature === expectedSignature;
  }

  /**
   * Process webhook notification
   */
  async processWebhook(payload, signature) {
    if (!this.validateWebhookSignature(JSON.stringify(payload), signature)) {
      throw new AppError('Invalid webhook signature', 401, 'INVALID_SIGNATURE');
    }

    const { type, data } = payload;

    switch (type) {
      case 'transaction.confirmed':
        await this.handleTransactionConfirmed(data);
        break;
      case 'transaction.failed':
        await this.handleTransactionFailed(data);
        break;
      case 'auto_payment.executed':
        await this.handleAutoPaymentExecuted(data);
        break;
      case 'auto_payment.failed':
        await this.handleAutoPaymentFailed(data);
        break;
      default:
        logger.warn('Unknown webhook type', { type: type });
    }
  }

  /**
   * Handle confirmed transaction webhook
   */
  async handleTransactionConfirmed(data) {
    logger.info('Transaction confirmed', {
      transactionHash: data.hash,
      confirmations: data.confirmations
    });

    // Update payment status in database
    // await PaymentService.updatePaymentStatus(data.hash, 'completed');
  }

  /**
   * Handle failed transaction webhook
   */
  async handleTransactionFailed(data) {
    logger.error('Transaction failed', {
      transactionHash: data.hash,
      reason: data.reason
    });

    // Update payment status in database
    // await PaymentService.updatePaymentStatus(data.hash, 'failed');
  }

  /**
   * Handle executed auto payment webhook
   */
  async handleAutoPaymentExecuted(data) {
    logger.info('Auto payment executed', {
      autoPaymentId: data.autoPaymentId,
      transactionHash: data.transactionHash
    });

    // Create payment record
    // await PaymentService.createAutoPaymentRecord(data);
  }

  /**
   * Handle failed auto payment webhook
   */
  async handleAutoPaymentFailed(data) {
    logger.error('Auto payment failed', {
      autoPaymentId: data.autoPaymentId,
      reason: data.reason
    });

    // Notify tenant and landlord
    // await NotificationService.notifyAutoPaymentFailed(data);
  }
}

module.exports = new FairCoinService();
