/**
 * Property Model
 * Represents rental properties in the system
 */
class Property {
  constructor(data = {}) {
    this.id = data.id || null;
    this.ownerId = data.ownerId || null;
    // Title removed - will be generated dynamically when displaying properties
    this.description = data.description || '';
    this.address = {
      street: data.address?.street || '',
      city: data.address?.city || '',
      state: data.address?.state || '',
      zipCode: data.address?.zipCode || '',
      country: data.address?.country || '',
      coordinates: {
        lat: data.address?.coordinates?.lat || null,
        lng: data.address?.coordinates?.lng || null
      }
    };
    this.type = data.type || 'apartment'; // apartment, house, room, studio
    this.housingType = data.housingType || 'private'; // private, public
    this.bedrooms = data.bedrooms || 0;
    this.bathrooms = data.bathrooms || 0;
    this.squareFootage = data.squareFootage || 0;
    this.rent = {
      amount: data.rent?.amount || 0,
      currency: data.rent?.currency || 'USD',
      paymentFrequency: data.rent?.paymentFrequency || 'monthly', // monthly, weekly, daily
      deposit: data.rent?.deposit || 0,
      utilities: data.rent?.utilities || 'excluded' // included, excluded, partial
    };
    this.amenities = data.amenities || [];
    this.rules = {
      pets: data.rules?.pets || false,
      smoking: data.rules?.smoking || false,
      parties: data.rules?.parties || false,
      guests: data.rules?.guests || true,
      maxOccupancy: data.rules?.maxOccupancy || 1
    };
    this.images = data.images || [];
    this.documents = data.documents || [];
    this.availability = {
      isAvailable: data.availability?.isAvailable || true,
      availableFrom: data.availability?.availableFrom || new Date(),
      minimumStay: data.availability?.minimumStay || 1, // months
      maximumStay: data.availability?.maximumStay || 12 // months
    };
    this.deviceId = data.deviceId || null; // Raspberry Pi device ID
    this.energyMonitoring = {
      enabled: data.energyMonitoring?.enabled || false,
      sensors: data.energyMonitoring?.sensors || []
    };
    this.rooms = data.rooms || []; // Array of room IDs or Room objects
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.status = data.status || 'active'; // active, inactive, archived
  }

  // Validation method
  validate() {
    const errors = [];
    
    // Required fields (title is now optional since we auto-generate it)
    if (!this.ownerId) {
      errors.push('Owner ID is required');
    }
    
    // Address validation
    if (!this.address.street || this.address.street.trim() === '') {
      errors.push('Street address is required and cannot be empty');
    }
    if (!this.address.city || this.address.city.trim() === '') {
      errors.push('City is required and cannot be empty');
    }
    if (!this.address.state || this.address.state.trim() === '') {
      errors.push('State is required and cannot be empty');
    }
    if (!this.address.zipCode || this.address.zipCode.trim() === '') {
      errors.push('ZIP code is required and cannot be empty');
    }
    
    // Rent validation
    if (!this.rent.amount || this.rent.amount <= 0) {
      errors.push('Rent amount must be greater than 0');
    }
    
    // Type validation
    const validTypes = ['apartment', 'house', 'room', 'studio', 'couchsurfing', 'roommates', 'coliving', 'hostel', 'guesthouse', 'campsite', 'boat', 'treehouse', 'yurt', 'other'];
    if (!validTypes.includes(this.type)) {
      errors.push(`Property type must be one of: ${validTypes.join(', ')}`);
    }

    // Housing type validation
    const validHousingTypes = ['private', 'public'];
    if (this.housingType && !validHousingTypes.includes(this.housingType)) {
      errors.push(`Housing type must be one of: ${validHousingTypes.join(', ')}`);
    }
    
    // Layout type validation
    const validLayoutTypes = ['open', 'shared', 'partitioned', 'traditional', 'studio', 'other'];
    if (this.layoutType && !validLayoutTypes.includes(this.layoutType)) {
      errors.push(`Layout type must be one of: ${validLayoutTypes.join(', ')}`);
    }
    
    // Optional field validation (if provided, must be valid)
    if (this.bedrooms < 0) {
      errors.push('Bedrooms cannot be negative');
    }
    if (this.bathrooms < 0) {
      errors.push('Bathrooms cannot be negative');
    }
    if (this.squareFootage < 0) {
      errors.push('Square footage cannot be negative');
    }
    
    // Currency validation
    const validCurrencies = ['USD', 'EUR', 'GBP', 'CAD'];
    if (this.rent.currency && !validCurrencies.includes(this.rent.currency)) {
      errors.push(`Currency must be one of: ${validCurrencies.join(', ')}`);
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
      ownerId: this.ownerId,
      // Title will be generated dynamically when displaying properties
      description: this.description,
      address: this.address,
      type: this.type,
      bedrooms: this.bedrooms,
      bathrooms: this.bathrooms,
      squareFootage: this.squareFootage,
      rent: this.rent,
      amenities: this.amenities,
      rules: this.rules,
      images: this.images,
      documents: this.documents,
      availability: this.availability,
      deviceId: this.deviceId,
      energyMonitoring: this.energyMonitoring,
      rooms: this.rooms,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      status: this.status
    };
  }
}

module.exports = Property;
