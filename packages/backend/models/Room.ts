/**
 * Room Model
 * Represents individual rooms within properties
 */
class Room {
  constructor(data = {}) {
    this.id = data.id || null;
    this.propertyId = data.propertyId || null;
    this.name = data.name || '';
    this.description = data.description || '';
    this.type = data.type || 'bedroom'; // bedroom, bathroom, kitchen, living_room, office, storage, other
    this.floor = data.floor || 1;
    this.dimensions = {
      length: data.dimensions?.length || 0, // feet
      width: data.dimensions?.width || 0, // feet
      height: data.dimensions?.height || 8, // feet
      squareFootage: data.dimensions?.squareFootage || 0
    };
    this.features = data.features || []; // closet, window, balcony, fireplace, etc.
    this.furniture = {
      furnished: data.furniture?.furnished || false,
      items: data.furniture?.items || [] // bed, desk, chair, dresser, etc.
    };
    this.rent = {
      amount: data.rent?.amount || 0,
      currency: data.rent?.currency || 'USD',
      deposit: data.rent?.deposit || 0,
      utilities: data.rent?.utilities || 'excluded' // included, excluded, partial
    };
    this.availability = {
      isAvailable: data.availability?.isAvailable || true,
      availableFrom: data.availability?.availableFrom || new Date(),
      minimumStay: data.availability?.minimumStay || 1, // months
      maximumStay: data.availability?.maximumStay || 12 // months
    };
    this.roommates = {
      maxOccupancy: data.roommates?.maxOccupancy || 1,
      currentOccupancy: data.roommates?.currentOccupancy || 0,
      genderPreference: data.roommates?.genderPreference || 'any', // male, female, any
      ageRange: {
        min: data.roommates?.ageRange?.min || 18,
        max: data.roommates?.ageRange?.max || 65
      },
      lifestyle: {
        smoking: data.roommates?.lifestyle?.smoking || false,
        pets: data.roommates?.lifestyle?.pets || false,
        parties: data.roommates?.lifestyle?.parties || false,
        quiet: data.roommates?.lifestyle?.quiet || false
      }
    };
    this.rules = {
      pets: data.rules?.pets || false,
      smoking: data.rules?.smoking || false,
      guests: data.rules?.guests || true,
      quietHours: {
        enabled: data.rules?.quietHours?.enabled || false,
        start: data.rules?.quietHours?.start || '22:00',
        end: data.rules?.quietHours?.end || '08:00'
      }
    };
    this.images = data.images || [];
    this.amenities = data.amenities || []; // private_bathroom, shared_bathroom, balcony, etc.
    this.energyMonitoring = {
      enabled: data.energyMonitoring?.enabled || false,
      sensors: data.energyMonitoring?.sensors || []
    };
    this.currentTenant = data.currentTenant || null;
    this.leaseId = data.leaseId || null;
    this.status = data.status || 'available'; // available, occupied, maintenance, reserved
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
  }

  // Calculate square footage if not provided
  calculateSquareFootage() {
    if (this.dimensions.length && this.dimensions.width) {
      this.dimensions.squareFootage = this.dimensions.length * this.dimensions.width;
    }
    return this.dimensions.squareFootage;
  }

  // Check if room is currently available
  isAvailable() {
    return this.status === 'available' && 
           this.availability.isAvailable && 
           new Date() >= this.availability.availableFrom &&
           this.roommates.currentOccupancy < this.roommates.maxOccupancy;
  }

  // Get room capacity utilization
  getCapacityUtilization() {
    if (this.roommates.maxOccupancy === 0) return 0;
    return (this.roommates.currentOccupancy / this.roommates.maxOccupancy) * 100;
  }

  // Check if room matches roommate preferences
  matchesPreferences(preferences = {}) {
    const matches = [];
    
    // Gender preference
    if (preferences.gender && this.roommates.genderPreference !== 'any') {
      matches.push(this.roommates.genderPreference === preferences.gender);
    }
    
    // Age range
    if (preferences.age) {
      matches.push(
        preferences.age >= this.roommates.ageRange.min && 
        preferences.age <= this.roommates.ageRange.max
      );
    }
    
    // Lifestyle preferences
    if (preferences.smoking !== undefined) {
      matches.push(this.roommates.lifestyle.smoking === preferences.smoking);
    }
    
    if (preferences.pets !== undefined) {
      matches.push(this.roommates.lifestyle.pets === preferences.pets);
    }
    
    if (preferences.quiet !== undefined) {
      matches.push(this.roommates.lifestyle.quiet === preferences.quiet);
    }
    
    // Budget
    if (preferences.maxBudget) {
      matches.push(this.rent.amount <= preferences.maxBudget);
    }
    
    return matches.every(match => match === true);
  }

  // Get room score based on features and preferences
  getRoomScore(preferences = {}) {
    let score = 50; // Base score
    
    // Size score (larger rooms get higher scores)
    if (this.dimensions.squareFootage > 0) {
      score += Math.min(this.dimensions.squareFootage / 10, 20);
    }
    
    // Features score
    score += this.features.length * 2;
    
    // Furniture score
    if (this.furniture.furnished) score += 10;
    
    // Amenities score
    score += this.amenities.length * 3;
    
    // Preference matching score
    if (this.matchesPreferences(preferences)) score += 15;
    
    // Availability score
    if (this.isAvailable()) score += 10;
    
    return Math.min(100, Math.round(score));
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.propertyId) errors.push('Property ID is required');
    if (!this.name) errors.push('Room name is required');
    if (!this.type) errors.push('Room type is required');
    if (this.rent.amount < 0) errors.push('Rent amount cannot be negative');
    if (this.roommates.maxOccupancy < 0) errors.push('Max occupancy cannot be negative');
    if (this.roommates.currentOccupancy > this.roommates.maxOccupancy) {
      errors.push('Current occupancy cannot exceed max occupancy');
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
      name: this.name,
      description: this.description,
      type: this.type,
      floor: this.floor,
      dimensions: this.dimensions,
      features: this.features,
      furniture: this.furniture,
      rent: this.rent,
      availability: this.availability,
      roommates: this.roommates,
      rules: this.rules,
      images: this.images,
      amenities: this.amenities,
      energyMonitoring: this.energyMonitoring,
      currentTenant: this.currentTenant,
      leaseId: this.leaseId,
      status: this.status,
      isAvailable: this.isAvailable(),
      capacityUtilization: this.getCapacityUtilization(),
      squareFootage: this.calculateSquareFootage(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }
}

module.exports = Room;
