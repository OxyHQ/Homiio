const { Property } = require('../../models');
const { paginationResponse, AppError } = require('../../middlewares/errorHandler');

export async function findNearbyProperties(req, res, next) {
  try {
    const { 
      longitude, 
      latitude, 
      maxDistance = 10000, 
      minRent, 
      maxRent, 
      type, 
      bedrooms, 
      bathrooms, 
      minBedrooms, 
      maxBedrooms, 
      minBathrooms, 
      maxBathrooms, 
      minSquareFootage, 
      maxSquareFootage, 
      minYearBuilt, 
      maxYearBuilt, 
      amenities, 
      available, 
      status,
      hasPhotos, 
      verified, 
      eco, 
      housingType, 
      layoutType, 
      furnishedStatus, 
      petFriendly, 
      utilitiesIncluded, 
      parkingType, 
      petPolicy, 
      leaseTerm, 
      priceUnit, 
      proximityToTransport, 
      proximityToSchools, 
      proximityToShopping, 
      availableFromBefore, 
      availableFromAfter, 
      excludeIds, 
      page = 1, 
      limit = 10 
    } = req.query;

    if (!longitude || !latitude) {
      return res.status(400).json({ 
        success: false, 
        message: 'Longitude and latitude are required', 
        error: 'MISSING_COORDINATES'
      });
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);
    const distance = parseFloat(maxDistance);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid coordinates provided', 
        error: 'INVALID_COORDINATES'
      });
    }

    // Use the updated findNearby method which works with Address references
    let nearbyQuery = Property.findNearby(lng, lat, distance);

    // Apply additional filters
    const filters: any = {};
    
    // Handle status parameter (preferred) or legacy available parameter
    if (status !== undefined) {
      switch (status) {
        case 'available':
          filters['availability.isAvailable'] = true;
          filters.status = 'published'; // Published and available for rent
          break;
        case 'rented':
          filters.status = 'rented';
          break;
        case 'reserved':
          filters.status = 'reserved';
          break;
        case 'sold':
          filters.status = 'sold';
          break;
        case 'inactive':
          filters.status = 'inactive';
          break;
        case 'draft':
          filters.status = 'draft';
          break;
        case 'published':
          filters.status = 'published';
          break;
      }
    } else if (available !== undefined) {
      // Legacy support for available parameter
      filters['availability.isAvailable'] = available === 'true';
      filters.status = 'published'; // Use published instead of active
    }

    // Exclude draft properties by default unless explicitly requested
    if (!req.query.includeDrafts && (!status || status !== 'draft')) {
      if (filters.status) {
        // Status is already set, but ensure we exclude drafts
        if (filters.status === 'published' || filters.status === 'inactive' || filters.status === 'rented' || filters.status === 'reserved' || filters.status === 'sold') {
          // Keep the existing status (it's already not draft)
        }
      } else {
        filters.status = { $ne: 'draft' };
      }
    }

    if (type) filters.type = type;
    
    if (minRent || maxRent) {
      filters['rent.amount'] = {};
      if (minRent) filters['rent.amount'].$gte = parseInt(String(minRent));
      if (maxRent) filters['rent.amount'].$lte = parseInt(String(maxRent));
    }

    if (minBedrooms || maxBedrooms) {
      const br: any = {};
      if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
      if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
      filters.bedrooms = br;
    } else if (bedrooms) {
      filters.bedrooms = parseInt(String(bedrooms));
    }

    if (minBathrooms || maxBathrooms) {
      const ba: any = {};
      if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
      if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
      filters.bathrooms = ba;
    } else if (bathrooms) {
      filters.bathrooms = parseInt(String(bathrooms));
    }

    if (minSquareFootage || maxSquareFootage) {
      const sf: any = {};
      if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
      if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
      filters.squareFootage = sf;
    }

    if (minYearBuilt || maxYearBuilt) {
      const yb: any = {};
      if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
      if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
      filters.yearBuilt = yb;
    }

    if (amenities) {
      const list = String(amenities).split(',').map(a => a.trim()).filter(Boolean);
      if (list.length) filters.amenities = { $in: list };
    }

    if (hasPhotos === 'true') filters['images.url'] = { $exists: true, $nin: [null, ''] };
    if (verified === 'true') filters.isVerified = true;
    if (eco === 'true') filters.isEcoFriendly = true;
    if (housingType) filters.housingType = String(housingType);
    if (layoutType) filters.layoutType = String(layoutType);
    if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);
    if (petPolicy) filters.petPolicy = String(petPolicy);
    if (leaseTerm) filters.leaseTerm = String(leaseTerm);
    if (priceUnit) filters.priceUnit = String(priceUnit);
    if (parkingType) filters.parkingType = String(parkingType);
    if (petFriendly !== undefined) filters.petFriendly = String(petFriendly) === 'true';
    if (utilitiesIncluded !== undefined) filters.utilitiesIncluded = String(utilitiesIncluded) === 'true';
    if (proximityToTransport !== undefined) filters.proximityToTransport = String(proximityToTransport) === 'true';
    if (proximityToSchools !== undefined) filters.proximityToSchools = String(proximityToSchools) === 'true';
    if (proximityToShopping !== undefined) filters.proximityToShopping = String(proximityToShopping) === 'true';

    if (availableFromBefore || availableFromAfter) {
      const af: any = {};
      if (availableFromAfter) {
        const d = new Date(String(availableFromAfter));
        if (!isNaN(d.getTime())) af.$gte = d;
      }
      if (availableFromBefore) {
        const d = new Date(String(availableFromBefore));
        if (!isNaN(d.getTime())) af.$lte = d;
      }
      if (Object.keys(af).length) filters.availableFrom = af;
    }

    if (excludeIds) {
      try {
        const mongoose = require('mongoose');
        const list = String(excludeIds)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
        if (list.length) filters._id = { $nin: list };
      } catch {}
    }

    // Apply additional filters to the nearby query
    if (Object.keys(filters).length > 0) {
      nearbyQuery = nearbyQuery.find(filters);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [properties, total] = await Promise.all([
      nearbyQuery.skip(skip).limit(parseInt(limit)).lean(),
      nearbyQuery.clone().countDocuments()
    ]);

    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, 'Nearby properties found successfully'));
  } catch (error) {
    next(error);
  }
}

export async function findPropertiesInRadius(req, res, next) {
  try {
    const { 
      longitude, 
      latitude, 
      radius, 
      minRent, 
      maxRent, 
      type, 
      bedrooms, 
      bathrooms, 
      minBedrooms, 
      maxBedrooms, 
      minBathrooms, 
      maxBathrooms, 
      minSquareFootage, 
      maxSquareFootage, 
      minYearBuilt, 
      maxYearBuilt, 
      amenities, 
      available, 
      status,
      hasPhotos, 
      verified, 
      eco, 
      housingType, 
      layoutType, 
      furnishedStatus, 
      petFriendly, 
      utilitiesIncluded, 
      parkingType, 
      petPolicy, 
      leaseTerm, 
      priceUnit, 
      proximityToTransport, 
      proximityToSchools, 
      proximityToShopping, 
      availableFromBefore, 
      availableFromAfter, 
      excludeIds, 
      page = 1, 
      limit = 10 
    } = req.query;

    if (!longitude || !latitude || !radius) {
      return res.status(400).json({ 
        success: false, 
        message: 'Longitude, latitude, and radius are required', 
        error: 'MISSING_PARAMETERS'
      });
    }

    const lng = parseFloat(longitude);
    const lat = parseFloat(latitude);
    const radiusInMeters = parseFloat(radius);

    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid coordinates provided', 
        error: 'INVALID_COORDINATES'
      });
    }

    // Use the updated findWithinRadius method which works with Address references
    let radiusQuery = Property.findWithinRadius(lng, lat, radiusInMeters);

    // Apply additional filters
    const filters: any = {};
    
    // Handle status parameter (preferred) or legacy available parameter
    if (status !== undefined) {
      switch (status) {
        case 'available':
          filters['availability.isAvailable'] = true;
          filters.status = 'published'; // Published and available for rent
          break;
        case 'rented':
          filters.status = 'rented';
          break;
        case 'reserved':
          filters.status = 'reserved';
          break;
        case 'sold':
          filters.status = 'sold';
          break;
        case 'inactive':
          filters.status = 'inactive';
          break;
        case 'draft':
          filters.status = 'draft';
          break;
        case 'published':
          filters.status = 'published';
          break;
      }
    } else if (available !== undefined) {
      // Legacy support for available parameter
      filters['availability.isAvailable'] = available === 'true';
      filters.status = 'published'; // Use published instead of active
    }

    // Exclude draft properties by default unless explicitly requested
    if (!req.query.includeDrafts && (!status || status !== 'draft')) {
      if (filters.status) {
        // Status is already set, but ensure we exclude drafts
        if (filters.status === 'published' || filters.status === 'inactive' || filters.status === 'rented' || filters.status === 'reserved' || filters.status === 'sold') {
          // Keep the existing status (it's already not draft)
        }
      } else {
        filters.status = { $ne: 'draft' };
      }
    }

    if (type) filters.type = type;
    
    if (minRent || maxRent) {
      filters['rent.amount'] = {};
      if (minRent) filters['rent.amount'].$gte = parseInt(String(minRent));
      if (maxRent) filters['rent.amount'].$lte = parseInt(String(maxRent));
    }

    if (minBedrooms || maxBedrooms) {
      const br: any = {};
      if (minBedrooms) br.$gte = parseInt(String(minBedrooms));
      if (maxBedrooms) br.$lte = parseInt(String(maxBedrooms));
      filters.bedrooms = br;
    } else if (bedrooms) {
      filters.bedrooms = parseInt(String(bedrooms));
    }

    if (minBathrooms || maxBathrooms) {
      const ba: any = {};
      if (minBathrooms) ba.$gte = parseInt(String(minBathrooms));
      if (maxBathrooms) ba.$lte = parseInt(String(maxBathrooms));
      filters.bathrooms = ba;
    } else if (bathrooms) {
      filters.bathrooms = parseInt(String(bathrooms));
    }

    if (minSquareFootage || maxSquareFootage) {
      const sf: any = {};
      if (minSquareFootage) sf.$gte = parseInt(String(minSquareFootage));
      if (maxSquareFootage) sf.$lte = parseInt(String(maxSquareFootage));
      filters.squareFootage = sf;
    }

    if (minYearBuilt || maxYearBuilt) {
      const yb: any = {};
      if (minYearBuilt) yb.$gte = parseInt(String(minYearBuilt));
      if (maxYearBuilt) yb.$lte = parseInt(String(maxYearBuilt));
      filters.yearBuilt = yb;
    }

    if (amenities) {
      const list = String(amenities).split(',').map(a => a.trim()).filter(Boolean);
      if (list.length) filters.amenities = { $in: list };
    }

    if (hasPhotos === 'true') filters['images.url'] = { $exists: true, $nin: [null, ''] };
    if (verified === 'true') filters.isVerified = true;
    if (eco === 'true') filters.isEcoFriendly = true;
    if (housingType) filters.housingType = String(housingType);
    if (layoutType) filters.layoutType = String(layoutType);
    if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);
    if (petPolicy) filters.petPolicy = String(petPolicy);
    if (leaseTerm) filters.leaseTerm = String(leaseTerm);
    if (priceUnit) filters.priceUnit = String(priceUnit);
    if (parkingType) filters.parkingType = String(parkingType);
    if (petFriendly !== undefined) filters.petFriendly = String(petFriendly) === 'true';
    if (utilitiesIncluded !== undefined) filters.utilitiesIncluded = String(utilitiesIncluded) === 'true';
    if (proximityToTransport !== undefined) filters.proximityToTransport = String(proximityToTransport) === 'true';
    if (proximityToSchools !== undefined) filters.proximityToSchools = String(proximityToSchools) === 'true';
    if (proximityToShopping !== undefined) filters.proximityToShopping = String(proximityToShopping) === 'true';

    if (availableFromBefore || availableFromAfter) {
      const af: any = {};
      if (availableFromAfter) {
        const d = new Date(String(availableFromAfter));
        if (!isNaN(d.getTime())) af.$gte = d;
      }
      if (availableFromBefore) {
        const d = new Date(String(availableFromBefore));
        if (!isNaN(d.getTime())) af.$lte = d;
      }
      if (Object.keys(af).length) filters.availableFrom = af;
    }

    if (excludeIds) {
      try {
        const mongoose = require('mongoose');
        const list = String(excludeIds)
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
          .filter(id => mongoose.Types.ObjectId.isValid(id))
          .map(id => new mongoose.Types.ObjectId(id));
        if (list.length) filters._id = { $nin: list };
      } catch {}
    }

    // Apply additional filters to the radius query
    if (Object.keys(filters).length > 0) {
      radiusQuery = radiusQuery.find(filters);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [properties, total] = await Promise.all([
      radiusQuery.skip(skip).limit(parseInt(limit)).lean(),
      radiusQuery.clone().countDocuments()
    ]);

    res.json(paginationResponse(properties, parseInt(page), parseInt(limit), total, 'Properties in radius found successfully'));
  } catch (error) {
    next(error);
  }
}
