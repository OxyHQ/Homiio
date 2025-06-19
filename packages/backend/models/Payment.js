/**
 * Payment Model
 * Represents rent payments and transactions
 */
class Payment {
  constructor(data = {}) {
    this.id = data.id || null;
    this.leaseId = data.leaseId || null;
    this.propertyId = data.propertyId || null;
    this.tenantId = data.tenantId || null;
    this.landlordId = data.landlordId || null;
    this.amount = data.amount || 0;
    this.currency = data.currency || 'USD';
    this.type = data.type || 'rent'; // rent, deposit, late_fee, utility, maintenance
    this.paymentMethod = data.paymentMethod || 'faircoin'; // faircoin, bank_transfer, credit_card, cash
    this.fairCoin = {
      transactionHash: data.fairCoin?.transactionHash || null,
      walletFrom: data.fairCoin?.walletFrom || null,
      walletTo: data.fairCoin?.walletTo || null,
      confirmations: data.fairCoin?.confirmations || 0,
      gasUsed: data.fairCoin?.gasUsed || 0
    };
    this.bankTransfer = {
      bankName: data.bankTransfer?.bankName || null,
      accountNumber: data.bankTransfer?.accountNumber || null,
      routingNumber: data.bankTransfer?.routingNumber || null,
      referenceNumber: data.bankTransfer?.referenceNumber || null
    };
    this.dueDate = data.dueDate || new Date();
    this.paidDate = data.paidDate || null;
    this.status = data.status || 'pending'; // pending, processing, completed, failed, cancelled
    this.description = data.description || '';
    this.receipt = {
      url: data.receipt?.url || null,
      filename: data.receipt?.filename || null,
      generated: data.receipt?.generated || false
    };
    this.fees = {
      processingFee: data.fees?.processingFee || 0,
      lateFee: data.fees?.lateFee || 0,
      otherFees: data.fees?.otherFees || 0
    };
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Check if payment is overdue
  isOverdue() {
    return this.status === 'pending' && new Date() > this.dueDate;
  }

  // Calculate days overdue
  getDaysOverdue() {
    if (!this.isOverdue()) return 0;
    const now = new Date();
    const diff = now.getTime() - this.dueDate.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  // Calculate total amount including fees
  getTotalAmount() {
    return this.amount + this.fees.processingFee + this.fees.lateFee + this.fees.otherFees;
  }

  // Check if payment is completed
  isCompleted() {
    return this.status === 'completed' && this.paidDate;
  }

  // Mark payment as completed
  markAsCompleted(transactionData = {}) {
    this.status = 'completed';
    this.paidDate = new Date();
    this.updatedAt = new Date();
    
    if (transactionData.transactionHash) {
      this.fairCoin.transactionHash = transactionData.transactionHash;
      this.fairCoin.confirmations = transactionData.confirmations || 1;
    }
    
    if (transactionData.referenceNumber) {
      this.bankTransfer.referenceNumber = transactionData.referenceNumber;
    }
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.leaseId) errors.push('Lease ID is required');
    if (!this.tenantId) errors.push('Tenant ID is required');
    if (!this.landlordId) errors.push('Landlord ID is required');
    if (this.amount <= 0) errors.push('Amount must be greater than 0');
    if (!this.dueDate) errors.push('Due date is required');
    
    if (this.paymentMethod === 'faircoin' && !this.fairCoin.walletTo) {
      errors.push('FairCoin wallet address is required');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Convert to JSON for API responses
  toJSON() {
    return {
      id: this.id,
      leaseId: this.leaseId,
      propertyId: this.propertyId,
      tenantId: this.tenantId,
      landlordId: this.landlordId,
      amount: this.amount,
      currency: this.currency,
      type: this.type,
      paymentMethod: this.paymentMethod,
      fairCoin: this.fairCoin,
      bankTransfer: this.bankTransfer,
      dueDate: this.dueDate,
      paidDate: this.paidDate,
      status: this.status,
      description: this.description,
      receipt: this.receipt,
      fees: this.fees,
      totalAmount: this.getTotalAmount(),
      isOverdue: this.isOverdue(),
      daysOverdue: this.getDaysOverdue(),
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Payment;
