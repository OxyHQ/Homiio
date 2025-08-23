/**
 * Room Controller
 * Handles room-related operations within properties
 */

const { Room, Property } = require('../models');
const { logger, businessLogger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');

class RoomController {
  /**
   * Create a new room within a property
   */
  async createRoom(req, res, next) {
    try {
      const { propertyId } = req.params;
      const roomData = {
        ...req.body,
        propertyId: propertyId
      };

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Create and validate room
      const room = new Room(roomData);
      
      // Calculate square footage if dimensions are provided
      if (room.dimensions?.length && room.dimensions?.width) {
        room.squareFootage = room.calculatedSquareFootage;
      }

      // Save room to database
      const savedRoom = await room.save();

      // Add room reference to property
      property.rooms.push(savedRoom._id);
      await property.save();

      logger.info('Room created', {
        roomId: savedRoom._id,
        propertyId: propertyId,
        profileId: req.userId
      });

      businessLogger.info('Room created', {
        roomId: savedRoom._id,
        propertyId: propertyId,
        profileId: req.userId,
        type: room.type,
        rent: room.rent?.amount
      });

      res.status(201).json(successResponse(
        savedRoom.toJSON(),
        'Room created successfully'
      ));
    } catch (error) {
      if (error.name === 'ValidationError') {
        next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', error.errors));
      } else {
        next(error);
      }
    }
  }

  /**
   * Get all rooms for a property
   */
  async getPropertyRooms(req, res, next) {
    try {
      const { propertyId } = req.params;
      const {
        page = 1,
        limit = 10,
        type,
        available,
        minRent,
        maxRent,
        furnished,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;

      // Verify property exists
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }

      // Build filters
      const filters: any = { propertyId };
      if (type) filters.type = type;
      if (available !== undefined) filters['availability.isAvailable'] = available === 'true';
      if (minRent) filters['rent.amount'] = { $gte: parseFloat(minRent) };
      if (maxRent) {
        filters['rent.amount'] = { 
          ...filters['rent.amount'],
          $lte: parseFloat(maxRent)
        };
      }

      // Build sort options
      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Query database with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);
      
      // Execute queries in parallel
      const [rooms, total] = await Promise.all([
        Room.find(filters)
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Room.countDocuments(filters)
      ]);

      logger.info('Property rooms retrieved', {
        propertyId,
        filters,
        total,
        page,
        limit
      });

      res.json(paginationResponse(
        rooms,
        parseInt(page),
        parseInt(limit),
        total,
        'Property rooms retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get room by ID
   */
  async getRoomById(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      // Verify property exists
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }

      // Fetch room with property verification
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      }).populate({
        path: 'currentLease',
        select: 'startDate endDate rent deposit'
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      logger.info('Room retrieved', {
        roomId,
        propertyId,
        status: room.status
      });

      res.json(successResponse(
        room.toJSON(),
        'Room retrieved successfully'
      ));
    } catch (error) {
      if (error.name === 'CastError') {
        next(new AppError('Invalid room ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Update room
   */
  async updateRoom(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const updateData = req.body;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find existing room
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Update room fields
      Object.assign(room, updateData);

      // Calculate square footage if dimensions are updated
      if (updateData.dimensions?.length && updateData.dimensions?.width) {
        room.squareFootage = room.calculatedSquareFootage;
      }

      // Save updated room
      const updatedRoom = await room.save();

      logger.info('Room updated', {
        roomId,
        propertyId,
        profileId: req.userId,
        updatedFields: Object.keys(updateData)
      });

      businessLogger.info('Room updated', {
        roomId,
        propertyId,
        profileId: req.userId,
        type: room.type,
        rent: room.rent?.amount,
        status: room.status
      });

      res.json(successResponse(
        updatedRoom.toJSON(),
        'Room updated successfully'
      ));
    } catch (error) {
      if (error.name === 'ValidationError') {
        next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', error.errors));
      } else if (error.name === 'CastError') {
        next(new AppError('Invalid room ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Delete room
   */
  async deleteRoom(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find room and verify it exists
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Check if room has active lease
      if (room.currentLease) {
        throw new AppError('Cannot delete room with active lease', 400, 'VALIDATION_ERROR');
      }

      // Remove room reference from property
      property.rooms = property.rooms.filter(id => id.toString() !== roomId);
      await property.save();

      // Soft delete by marking status as unavailable
      room.status = 'unavailable';
      room.availability.isAvailable = false;
      await room.save();

      logger.info('Room deleted', {
        roomId,
        propertyId,
        profileId: req.userId
      });

      businessLogger.info('Room deleted', {
        roomId,
        propertyId,
        profileId: req.userId,
        type: room.type,
        rent: room.rent?.amount
      });

      res.json(successResponse(
        null,
        'Room deleted successfully'
      ));
    } catch (error) {
      if (error.name === 'CastError') {
        next(new AppError('Invalid room ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Search available rooms
   */
  async searchRooms(req, res, next) {
    try {
      const {
        city,
        state,
        minRent,
        maxRent,
        type,
        furnished,
        amenities,
        genderPreference,
        minAge,
        maxAge,
        pets,
        smoking,
        page = 1,
        limit = 10,
        sortBy = 'rent.amount',
        sortOrder = 'asc'
      } = req.query;

      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);

      // Build property filters for location
      const propertyFilters: any = {
        status: 'active'
      };
      
      // Handle city and state filters with Address lookup
      if (city || state) {
        const { Address } = require('../models');
        const addressQuery: any = {};
        if (city) addressQuery.city = new RegExp(city, 'i');
        if (state) addressQuery.state = new RegExp(state, 'i');
        
        const matchingAddresses = await Address.find(addressQuery).select('_id');
        const addressIds = matchingAddresses.map(addr => addr._id);
        
        if (addressIds.length === 0) {
          // No matching addresses found, return empty result
          return res.json(paginationResponse([], pageNumber, limitNumber, 0, 'No rooms found'));
        }
        
        propertyFilters.addressId = { $in: addressIds };
      }

      // Find matching properties first
      const properties = await Property.find(propertyFilters)
        .populate('addressId')
        .select('_id addressId type rooms')
        .lean();

      const propertyIds = properties.map(p => p._id);

      // Build room filters
      const roomFilters: any = {
        propertyId: { $in: propertyIds },
        status: 'available',
        'availability.isAvailable': true
      };

      if (type) roomFilters.type = type;
      if (minRent || maxRent) {
        roomFilters['rent.amount'] = {};
        if (minRent) roomFilters['rent.amount'].$gte = parseFloat(minRent);
        if (maxRent) roomFilters['rent.amount'].$lte = parseFloat(maxRent);
      }
      if (amenities) {
        const amenityList = amenities.split(',').map(a => a.trim());
        roomFilters.amenities = { $all: amenityList };
      }

      // Build sort options
      const sortOptions: any = {};
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

      // Query database with pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      // Execute queries in parallel
      const [rooms, total] = await Promise.all([
        Room.find(roomFilters)
          .sort(sortOptions)
          .skip(skip)
          .limit(parseInt(limit))
          .lean(),
        Room.countDocuments(roomFilters)
      ]);

      // Combine room and property data
      const propertyMap = properties.reduce((map, property) => {
        map[property._id.toString()] = property;
        return map;
      }, {});

      const searchResults = rooms.map(room => {
        const property = propertyMap[room.propertyId.toString()];
        const matchScore = this.calculateMatchScore(room, property, {
          pets,
          smoking,
          genderPreference,
          minAge,
          maxAge
        });

        return {
          room,
          property: {
            id: property._id,
            address: property.address,
            type: property.type
          },
          matchScore
        };
      });

      // Sort by match score if preferences were provided
      if (pets !== undefined || smoking !== undefined || genderPreference) {
        searchResults.sort((a, b) => b.matchScore - a.matchScore);
      }

      logger.info('Room search completed', {
        filters: roomFilters,
        total,
        page,
        limit,
        resultCount: searchResults.length
      });

      res.json(paginationResponse(
        searchResults,
        parseInt(page),
        parseInt(limit),
        total,
        'Room search completed successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Calculate match score based on preferences
   * @private
   */
  private calculateMatchScore(room, property, preferences) {
    let score = 100;
    const {
      pets,
      smoking,
      genderPreference,
      minAge,
      maxAge
    } = preferences;

    // Adjust score based on preferences
    if (pets !== undefined) {
      const petsAllowed = property.petPolicy === 'allowed';
      if (pets === 'true' && !petsAllowed) score -= 20;
    }

    if (smoking !== undefined) {
      if (smoking === 'true' && !property.smokingAllowed) score -= 20;
    }

    if (genderPreference && room.occupancy?.genderPreference) {
      if (genderPreference !== room.occupancy.genderPreference && 
          room.occupancy.genderPreference !== 'any') {
        score -= 30;
      }
    }

    if (minAge || maxAge) {
      const roomMinAge = room.occupancy?.ageRange?.min || 0;
      const roomMaxAge = room.occupancy?.ageRange?.max || 100;
      
      if (minAge && parseInt(minAge) < roomMinAge) score -= 15;
      if (maxAge && parseInt(maxAge) > roomMaxAge) score -= 15;
    }

    return Math.max(0, score);
  }

  /**
   * Update room availability
   */
  async updateRoomAvailability(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { isAvailable, availableFrom, tenantId } = req.body;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find room and verify it exists
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Update room availability
      room.availability = {
        ...room.availability,
        isAvailable: isAvailable,
        availableFrom: availableFrom ? new Date(availableFrom) : new Date()
      };

      // Update status and occupancy based on availability
      if (isAvailable) {
        room.status = 'available';
        if (tenantId) {
          // Remove tenant if making room available
          room.occupancy.occupantIds = room.occupancy.occupantIds.filter(id => id !== tenantId);
          room.occupancy.currentOccupants = room.occupancy.occupantIds.length;
        }
      } else {
        room.status = 'occupied';
        if (tenantId && !room.occupancy.occupantIds.includes(tenantId)) {
          // Add tenant if making room unavailable
          if (room.occupancy.currentOccupants < room.occupancy.maxOccupants) {
            room.occupancy.occupantIds.push(tenantId);
            room.occupancy.currentOccupants = room.occupancy.occupantIds.length;
          } else {
            throw new AppError('Room is at maximum occupancy', 400, 'VALIDATION_ERROR');
          }
        }
      }

      // Save changes
      const updatedRoom = await room.save();

      logger.info('Room availability updated', {
        roomId,
        propertyId,
        profileId: req.userId,
        isAvailable,
        tenantId,
        status: updatedRoom.status
      });

      businessLogger.info('Room availability updated', {
        roomId,
        propertyId,
        profileId: req.userId,
        isAvailable,
        tenantId,
        status: updatedRoom.status,
        type: room.type,
        rent: room.rent?.amount
      });

      res.json(successResponse(
        updatedRoom.toJSON(),
        'Room availability updated successfully'
      ));
    } catch (error) {
      if (error.name === 'ValidationError') {
        next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', error.errors));
      } else if (error.name === 'CastError') {
        next(new AppError('Invalid room ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Assign a tenant to a room
   */
  async assignTenant(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { tenantId } = req.body;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find room and verify it exists
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Check if room is available
      if (!room.availability.isAvailable) {
        throw new AppError('Room is not available', 400, 'VALIDATION_ERROR');
      }

      // Check occupancy limits
      if (room.occupancy.currentOccupants >= room.occupancy.maxOccupants) {
        throw new AppError('Room is at maximum occupancy', 400, 'VALIDATION_ERROR');
      }

      // Check if tenant is already assigned
      if (room.occupancy.occupantIds.includes(tenantId)) {
        throw new AppError('Tenant is already assigned to this room', 400, 'VALIDATION_ERROR');
      }

      // Add tenant and update room status
      room.occupancy.occupantIds.push(tenantId);
      room.occupancy.currentOccupants = room.occupancy.occupantIds.length;
      room.status = 'occupied';
      room.availability.isAvailable = false;

      // Save changes
      const updatedRoom = await room.save();

      logger.info('Tenant assigned to room', {
        roomId,
        propertyId,
        profileId: req.userId,
        tenantId,
        status: updatedRoom.status
      });

      businessLogger.info('Tenant assigned to room', {
        roomId,
        propertyId,
        profileId: req.userId,
        tenantId,
        status: updatedRoom.status,
        type: room.type,
        rent: room.rent?.amount
      });

      res.json(successResponse(
        updatedRoom.toJSON(),
        'Tenant assigned successfully'
      ));
    } catch (error) {
      if (error.name === 'ValidationError') {
        next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', error.errors));
      } else if (error.name === 'CastError') {
        next(new AppError('Invalid room or tenant ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Unassign tenant from a room
   */
  async unassignTenant(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { tenantId } = req.body;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find room and verify it exists
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      });

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Check if tenant is assigned to the room
      if (!room.occupancy.occupantIds.includes(tenantId)) {
        throw new AppError('Tenant is not assigned to this room', 400, 'VALIDATION_ERROR');
      }

      // Remove tenant and update room status
      room.occupancy.occupantIds = room.occupancy.occupantIds.filter(id => id !== tenantId);
      room.occupancy.currentOccupants = room.occupancy.occupantIds.length;

      // If no more occupants, mark room as available
      if (room.occupancy.currentOccupants === 0) {
        room.status = 'available';
        room.availability.isAvailable = true;
      }

      // Save changes
      const updatedRoom = await room.save();

      logger.info('Tenant unassigned from room', {
        roomId,
        propertyId,
        profileId: req.userId,
        tenantId,
        status: updatedRoom.status
      });

      businessLogger.info('Tenant unassigned from room', {
        roomId,
        propertyId,
        profileId: req.userId,
        tenantId,
        status: updatedRoom.status,
        type: room.type,
        rent: room.rent?.amount
      });

      res.json(successResponse(
        updatedRoom.toJSON(),
        'Tenant unassigned successfully'
      ));
    } catch (error) {
      if (error.name === 'ValidationError') {
        next(new AppError('Validation failed', 400, 'VALIDATION_ERROR', error.errors));
      } else if (error.name === 'CastError') {
        next(new AppError('Invalid room or tenant ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Get statistics for a single room
   */
  async getRoomStats(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Find room and verify it exists
      const room = await Room.findOne({
        _id: roomId,
        propertyId: propertyId
      }).populate('leaseHistory');

      if (!room) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      // Calculate occupancy rate over the last year
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

      const leases = room.leaseHistory || [];
      const totalDays = 365;
      const occupiedDays = leases.reduce((total, lease) => {
        const startDate = new Date(Math.max(new Date(lease.startDate).getTime(), oneYearAgo.getTime()));
        const endDate = lease.endDate ? new Date(lease.endDate) : new Date();
        const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        return total + days;
      }, 0);

      const occupancyRate = Math.round((occupiedDays / totalDays) * 100);

      // Calculate average stay duration from lease history
      const stayDurations = leases.map(lease => {
        const startDate = new Date(lease.startDate);
        const endDate = lease.endDate ? new Date(lease.endDate) : new Date();
        return Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)); // in months
      });

      const averageStayDuration = stayDurations.length > 0
        ? Math.round(stayDurations.reduce((a, b) => a + b, 0) / stayDurations.length)
        : 0;

      // Calculate monthly revenue (current rent)
      const monthlyRevenue = room.rent?.amount || 0;

      // Get maintenance requests count
      const maintenanceRequests = room.maintenanceSchedule?.filter(m => 
        m.scheduledDate >= oneYearAgo
      ).length || 0;

      // Get energy consumption if available
      const energySensor = room.sensors?.find(s => s.type === 'energy');
      const energyConsumption = energySensor?.lastReading?.value || 0;

      const stats = {
        occupancyRate,
        averageStayDuration,
        monthlyRevenue,
        maintenanceRequests,
        energyConsumption,
        currentOccupants: room.occupancy.currentOccupants,
        maxOccupants: room.occupancy.maxOccupants,
        status: room.status,
        squareFootage: room.squareFootage || room.calculatedSquareFootage,
        amenitiesCount: room.amenities?.length || 0,
        lastMaintenanceDate: room.maintenanceSchedule?.length > 0
          ? room.maintenanceSchedule[room.maintenanceSchedule.length - 1].scheduledDate
          : null
      };

      logger.info('Room stats retrieved', {
        roomId,
        propertyId,
        profileId: req.userId,
        occupancyRate,
        status: room.status
      });

      res.json(successResponse(
        stats,
        'Room statistics retrieved successfully'
      ));
    } catch (error) {
      if (error.name === 'CastError') {
        next(new AppError('Invalid room ID', 400, 'VALIDATION_ERROR'));
      } else {
        next(error);
      }
    }
  }

  /**
   * Get room statistics for a property
   */
  async getRoomStatistics(req, res, next) {
    try {
      const { propertyId } = req.params;

      // Verify property ownership
      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'NOT_FOUND');
      }
      if (property.profileId.toString() !== req.userId) {
        throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      }

      // Get all rooms for the property
      const rooms = await Room.find({ propertyId });

      // Calculate statistics
      const total = rooms.length;
      const byStatus = {
        available: rooms.filter(r => r.status === 'available').length,
        occupied: rooms.filter(r => r.status === 'occupied').length,
        maintenance: rooms.filter(r => r.status === 'maintenance').length,
        renovating: rooms.filter(r => r.status === 'renovating').length,
        unavailable: rooms.filter(r => r.status === 'unavailable').length
      };

      // Calculate average rent
      const totalRent = rooms.reduce((sum, room) => sum + (room.rent?.amount || 0), 0);
      const averageRent = total > 0 ? Math.round(totalRent / total) : 0;

      // Calculate occupancy rate
      const occupiedRooms = rooms.reduce((count, room) => 
        count + (room.occupancy?.currentOccupants || 0), 0);
      const totalCapacity = rooms.reduce((count, room) => 
        count + (room.occupancy?.maxOccupants || 0), 0);
      const occupancyRate = totalCapacity > 0 
        ? Math.round((occupiedRooms / totalCapacity) * 100)
        : 0;

      // Calculate average size
      const totalSize = rooms.reduce((sum, room) => 
        sum + (room.squareFootage || room.calculatedSquareFootage || 0), 0);
      const averageSize = total > 0 ? Math.round(totalSize / total) : 0;

      // Group by type
      const byType = rooms.reduce((acc, room) => {
        acc[room.type] = (acc[room.type] || 0) + 1;
        return acc;
      }, {});

      // Calculate revenue metrics
      const potentialMonthlyRevenue = totalRent;
      const actualMonthlyRevenue = rooms
        .filter(r => r.status === 'occupied')
        .reduce((sum, room) => sum + (room.rent?.amount || 0), 0);
      
      const revenueEfficiency = potentialMonthlyRevenue > 0
        ? Math.round((actualMonthlyRevenue / potentialMonthlyRevenue) * 100)
        : 0;

      const stats = {
        total,
        byStatus,
        averageRent,
        occupancyRate,
        averageSize,
        byType,
        revenue: {
          potential: potentialMonthlyRevenue,
          actual: actualMonthlyRevenue,
          efficiency: revenueEfficiency
        },
        amenities: {
          total: rooms.reduce((sum, room) => sum + (room.amenities?.length || 0), 0),
          average: total > 0 ? Math.round(rooms.reduce((sum, room) => 
            sum + (room.amenities?.length || 0), 0) / total) : 0
        },
        maintenance: {
          pending: rooms.reduce((sum, room) => 
            sum + (room.maintenanceSchedule?.filter(m => 
              m.status === 'scheduled').length || 0), 0),
          completed: rooms.reduce((sum, room) => 
            sum + (room.maintenanceSchedule?.filter(m => 
              m.status === 'completed').length || 0), 0)
        }
      };

      logger.info('Property room statistics retrieved', {
        propertyId,
        profileId: req.userId,
        total,
        occupancyRate,
        revenueEfficiency
      });

      businessLogger.info('Property room statistics', {
        propertyId,
        profileId: req.userId,
        total,
        occupancyRate,
        revenueEfficiency,
        averageRent,
        potentialRevenue: potentialMonthlyRevenue,
        actualRevenue: actualMonthlyRevenue
      });

      res.json(successResponse(
        stats,
        'Room statistics retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new RoomController();
