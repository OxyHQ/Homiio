/**
 * User Model
 * Represents users in the Homio system (landlords, tenants, etc.)
 */
class User {
  constructor(data = {}) {
    this.id = data.id || null;
    this.oxyUserId = data.oxyUserId || null; // Reference to Oxy ecosystem user
    this.email = data.email || '';
    this.username = data.username || '';
    this.profile = {
      firstName: data.profile?.firstName || '',
      lastName: data.profile?.lastName || '',
      phoneNumber: data.profile?.phoneNumber || '',
      dateOfBirth: data.profile?.dateOfBirth || null,
      avatar: data.profile?.avatar || null,
      bio: data.profile?.bio || '',
      preferredLanguage: data.profile?.preferredLanguage || 'en'
    };
    this.role = data.role || 'tenant'; // tenant, landlord, property_manager, admin
    this.verification = {
      email: data.verification?.email || false,
      phone: data.verification?.phone || false,
      identity: data.verification?.identity || false,
      background: data.verification?.background || false,
      income: data.verification?.income || false
    };
    this.preferences = {
      notifications: {
        email: data.preferences?.notifications?.email || true,
        sms: data.preferences?.notifications?.sms || false,
        push: data.preferences?.notifications?.push || true,
        rentReminders: data.preferences?.notifications?.rentReminders || true,
        maintenanceAlerts: data.preferences?.notifications?.maintenanceAlerts || true,
        energyReports: data.preferences?.notifications?.energyReports || true
      },
      privacy: {
        showEmail: data.preferences?.privacy?.showEmail || false,
        showPhone: data.preferences?.privacy?.showPhone || false,
        profileVisible: data.preferences?.privacy?.profileVisible || true
      },
      energy: {
        alertsEnabled: data.preferences?.energy?.alertsEnabled || true,
        reportFrequency: data.preferences?.energy?.reportFrequency || 'weekly',
        thresholds: data.preferences?.energy?.thresholds || {}
      }
    };
    this.addresses = data.addresses || [];
    this.documents = data.documents || []; // ID, lease agreements, etc.
    this.fairCoin = {
      walletAddress: data.fairCoin?.walletAddress || null,
      autoPayments: data.fairCoin?.autoPayments || false,
      balance: data.fairCoin?.balance || 0
    };
    this.horizon = {
      connected: data.horizon?.connected || false,
      userId: data.horizon?.userId || null,
      lastSync: data.horizon?.lastSync || null
    };
    this.ratings = {
      asLandlord: {
        average: data.ratings?.asLandlord?.average || 0,
        count: data.ratings?.asLandlord?.count || 0,
        reviews: data.ratings?.asLandlord?.reviews || []
      },
      asTenant: {
        average: data.ratings?.asTenant?.average || 0,
        count: data.ratings?.asTenant?.count || 0,
        reviews: data.ratings?.asTenant?.reviews || []
      }
    };
    this.subscription = {
      plan: data.subscription?.plan || 'basic', // basic, premium, pro
      status: data.subscription?.status || 'active',
      expiresAt: data.subscription?.expiresAt || null,
      features: data.subscription?.features || []
    };
    this.lastLoginAt = data.lastLoginAt || null;
    this.isActive = data.isActive || true;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Get user's full name
  getFullName() {
    return `${this.profile.firstName} ${this.profile.lastName}`.trim();
  }

  // Check if user is verified
  isVerified() {
    return this.verification.email && this.verification.phone && this.verification.identity;
  }

  // Check if user is a landlord
  isLandlord() {
    return this.role === 'landlord' || this.role === 'property_manager';
  }

  // Check if user is a tenant
  isTenant() {
    return this.role === 'tenant';
  }

  // Get verification status
  getVerificationStatus() {
    const verifiedCount = Object.values(this.verification).filter(Boolean).length;
    const totalChecks = Object.keys(this.verification).length;
    return {
      percentage: Math.round((verifiedCount / totalChecks) * 100),
      completed: verifiedCount,
      total: totalChecks,
      isComplete: verifiedCount === totalChecks
    };
  }

  // Calculate trust score (0-100)
  getTrustScore() {
    let score = 0;
    
    // Verification score (40 points)
    const verificationStatus = this.getVerificationStatus();
    score += (verificationStatus.percentage * 0.4);
    
    // Rating score (30 points)
    const relevantRating = this.isLandlord() ? this.ratings.asLandlord : this.ratings.asTenant;
    if (relevantRating.count > 0) {
      score += (relevantRating.average / 5) * 30;
    }
    
    // Account age score (20 points)
    const accountAge = Date.now() - this.createdAt.getTime();
    const ageInMonths = accountAge / (1000 * 60 * 60 * 24 * 30);
    score += Math.min(ageInMonths * 2, 20);
    
    // Activity score (10 points)
    if (this.lastLoginAt) {
      const daysSinceLogin = (Date.now() - this.lastLoginAt.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceLogin < 7) score += 10;
      else if (daysSinceLogin < 30) score += 5;
    }
    
    return Math.min(100, Math.round(score));
  }

  // Update last login
  updateLastLogin() {
    this.lastLoginAt = new Date();
    this.updatedAt = new Date();
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.email) errors.push('Email is required');
    if (!this.username) errors.push('Username is required');
    if (!this.profile.firstName) errors.push('First name is required');
    if (!this.profile.lastName) errors.push('Last name is required');
    if (!this.role) errors.push('Role is required');
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (this.email && !emailRegex.test(this.email)) {
      errors.push('Invalid email format');
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Convert to JSON for API responses (excluding sensitive data)
  toJSON() {
    return {
      id: this.id,
      oxyUserId: this.oxyUserId,
      email: this.email,
      username: this.username,
      profile: this.profile,
      role: this.role,
      verification: this.verification,
      preferences: this.preferences,
      addresses: this.addresses,
      fairCoin: {
        walletAddress: this.fairCoin.walletAddress,
        autoPayments: this.fairCoin.autoPayments
        // Balance excluded for security
      },
      horizon: this.horizon,
      ratings: this.ratings,
      subscription: this.subscription,
      fullName: this.getFullName(),
      isVerified: this.isVerified(),
      verificationStatus: this.getVerificationStatus(),
      trustScore: this.getTrustScore(),
      lastLoginAt: this.lastLoginAt,
      isActive: this.isActive,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  // Convert to public JSON (for public profiles)
  toPublicJSON() {
    return {
      id: this.id,
      username: this.username,
      profile: {
        firstName: this.profile.firstName,
        lastName: this.profile.lastName,
        avatar: this.profile.avatar,
        bio: this.profile.bio
      },
      role: this.role,
      ratings: this.ratings,
      fullName: this.getFullName(),
      trustScore: this.getTrustScore(),
      isVerified: this.isVerified(),
      createdAt: this.createdAt
    };
  }
}

module.exports = User;
