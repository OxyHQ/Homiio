/**
 * Property Model
 * Represents rental properties in the system
 */
class Property {
  constructor(data = {}) {
    this.id = data.id || null;
    this.ownerId = data.ownerId || null;
    this.title = data.title || '';
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
    this.fairCoinEnabled = data.fairCoinEnabled || false;
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.status = data.status || 'active'; // active, inactive, archived
  }

  // Validation method
  validate() {
    const errors = [];
    
    if (!this.title) errors.push('Title is required');
    if (!this.ownerId) errors.push('Owner ID is required');
    if (!this.address.street) errors.push('Street address is required');
    if (!this.address.city) errors.push('City is required');
    if (this.rent.amount <= 0) errors.push('Rent amount must be greater than 0');
    
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
      title: this.title,
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
      fairCoinEnabled: this.fairCoinEnabled,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      status: this.status
    };
  }
}

module.exports = Property;
