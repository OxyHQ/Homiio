/**
 * Lease Model
 * Represents rental agreements between landlords and tenants
 */
class Lease {
  constructor(data = {}) {
    this.id = data.id || null;
    this.propertyId = data.propertyId || null;
    this.landlordId = data.landlordId || null;
    this.tenantId = data.tenantId || null;
    this.startDate = data.startDate || new Date();
    this.endDate = data.endDate || null;
    this.rent = {
      amount: data.rent?.amount || 0,
      currency: data.rent?.currency || 'USD',
      paymentFrequency: data.rent?.paymentFrequency || 'monthly',
      dueDay: data.rent?.dueDay || 1, // day of month rent is due
      lateFee: data.rent?.lateFee || 0,
      deposit: data.rent?.deposit || 0
    };
    this.terms = {
      duration: data.terms?.duration || 12, // months
      autoRenewal: data.terms?.autoRenewal || false,
      noticePeriod: data.terms?.noticePeriod || 30, // days
      earlyTerminationFee: data.terms?.earlyTerminationFee || 0
    };
    this.fairCoin = {
      enabled: data.fairCoin?.enabled || false,
      walletAddress: data.fairCoin?.walletAddress || null,
      autoPayment: data.fairCoin?.autoPayment || false
    };
    this.signatures = {
      landlord: {
        signed: data.signatures?.landlord?.signed || false,
        signedAt: data.signatures?.landlord?.signedAt || null,
        signature: data.signatures?.landlord?.signature || null
      },
      tenant: {
        signed: data.signatures?.tenant?.signed || false,
        signedAt: data.signatures?.tenant?.signedAt || null,
        signature: data.signatures?.tenant?.signature || null
      }
    };
    this.documents = data.documents || [];
    this.status = data.status || 'draft'; // draft, active, expired, terminated
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Check if lease is fully executed
  isFullyExecuted() {
    return this.signatures.landlord.signed && this.signatures.tenant.signed;
  }

  // Check if lease is currently active
  isActive() {
    const now = new Date();
    return this.status === 'active' && 
           this.startDate <= now && 
           (!this.endDate || this.endDate > now);
  }

  // Calculate remaining lease duration
  getRemainingDuration() {
    if (!this.endDate) return null;
    const now = new Date();
    const diff = this.endDate.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24)); // days
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.propertyId) errors.push('Property ID is required');
    if (!this.landlordId) errors.push('Landlord ID is required');
    if (!this.tenantId) errors.push('Tenant ID is required');
    if (!this.startDate) errors.push('Start date is required');
    if (this.rent.amount <= 0) errors.push('Rent amount must be greater than 0');
    if (this.endDate && this.endDate <= this.startDate) {
      errors.push('End date must be after start date');
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
      propertyId: this.propertyId,
      landlordId: this.landlordId,
      tenantId: this.tenantId,
      startDate: this.startDate,
      endDate: this.endDate,
      rent: this.rent,
      terms: this.terms,
      fairCoin: this.fairCoin,
      signatures: this.signatures,
      documents: this.documents,
      status: this.status,
      isActive: this.isActive(),
      remainingDuration: this.getRemainingDuration(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Lease;
