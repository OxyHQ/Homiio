/**
 * Room Controller
 * Handles room-related operations within properties
 */

const { Room, Property } = require('../models');
const { energyService } = require('../services');
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

      const room = new Room(roomData);
      const validation = room.validate();
      
      if (!validation.isValid) {
        throw new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      }

      // In a real implementation, verify property ownership and save to database
      // const property = await PropertyModel.findById(propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied to this property', 403, 'FORBIDDEN');
      // }
      // const savedRoom = await RoomModel.create(room);
      
      room.id = `room_${Date.now()}`;
      room.calculateSquareFootage();

      logger.info('Room created', {
        roomId: room.id,
        propertyId: propertyId,
        ownerId: req.userId
      });

      res.status(201).json(successResponse(
        room.toJSON(),
        'Room created successfully'
      ));
    } catch (error) {
      next(error);
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

      // Build filters
      const filters: any = { propertyId };
      if (type) filters.type = type;
      if (available !== undefined) filters.available = available === 'true';
      if (minRent) filters.minRent = parseFloat(minRent);
      if (maxRent) filters.maxRent = parseFloat(maxRent);
      if (furnished !== undefined) filters.furnished = furnished === 'true';

      // In a real implementation, query database with filters
      // const { rooms, total } = await RoomModel.findWithFilters(filters, { page, limit, sortBy, sortOrder });
      
      // Mock data for demonstration
      const mockRooms = [
        new Room({
          id: 'room_1',
          propertyId: propertyId,
          name: 'Master Bedroom',
          type: 'bedroom',
          dimensions: { length: 14, width: 12, height: 9 },
          rent: { amount: 1200, currency: 'USD' },
          furniture: { furnished: true, items: ['bed', 'desk', 'dresser'] },
          amenities: ['private_bathroom', 'balcony', 'walk_in_closet'],
          status: 'available'
        }),
        new Room({
          id: 'room_2',
          propertyId: propertyId,
          name: 'Second Bedroom',
          type: 'bedroom',
          dimensions: { length: 12, width: 10, height: 9 },
          rent: { amount: 900, currency: 'USD' },
          furniture: { furnished: false },
          amenities: ['shared_bathroom', 'closet'],
          status: 'occupied'
        })
      ];

      const rooms = mockRooms.map(r => r.toJSON());
      const total = mockRooms.length;

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

      // In a real implementation, fetch from database
      // const room = await RoomModel.findById(roomId);
      
      const mockRoom = new Room({
        id: roomId,
        propertyId: propertyId,
        name: 'Master Bedroom',
        description: 'Spacious master bedroom with private bathroom and balcony',
        type: 'bedroom',
        floor: 2,
        dimensions: { length: 14, width: 12, height: 9 },
        features: ['window', 'balcony', 'ceiling_fan', 'hardwood_floors'],
        furniture: {
          furnished: true,
          items: ['queen_bed', 'nightstands', 'dresser', 'desk', 'chair']
        },
        rent: { amount: 1200, currency: 'USD', deposit: 1200, utilities: 'excluded' },
        availability: {
          isAvailable: true,
          availableFrom: new Date(),
          minimumStay: 6,
          maximumStay: 12
        },
        roommates: {
          maxOccupancy: 1,
          currentOccupancy: 0,
          genderPreference: 'any',
          ageRange: { min: 21, max: 35 },
          lifestyle: { smoking: false, pets: true, quiet: true }
        },
        amenities: ['private_bathroom', 'balcony', 'walk_in_closet'],
        images: ['room1.jpg', 'room2.jpg'],
        status: 'available'
      });

      if (!mockRoom) {
        throw new AppError('Room not found', 404, 'NOT_FOUND');
      }

      res.json(successResponse(
        mockRoom.toJSON(),
        'Room retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update room
   */
  async updateRoom(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const updateData = req.body;

      // In a real implementation, check ownership and update in database
      // const property = await PropertyModel.findById(propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied', 403, 'FORBIDDEN');
      // }

      const updatedRoom = new Room({
        id: roomId,
        propertyId: propertyId,
        ...updateData,
        updatedAt: new Date()
      });

      const validation = updatedRoom.validate();
      if (!validation.isValid) {
        throw new AppError('Validation failed', 400, 'VALIDATION_ERROR');
      }

      updatedRoom.calculateSquareFootage();

      res.json(successResponse(
        updatedRoom.toJSON(),
        'Room updated successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete room
   */
  async deleteRoom(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      // In a real implementation, check ownership and soft delete
      // const property = await PropertyModel.findById(propertyId);
      // if (property.ownerId !== req.userId) {
      //   throw new AppError('Access denied', 403, 'FORBIDDEN');
      // }
      // await RoomModel.softDelete(roomId);

      res.json(successResponse(
        null,
        'Room deleted successfully'
      ));
    } catch (error) {
      next(error);
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
        limit = 10
      } = req.query;

      // Build search filters
      const filters: any = {};
      if (city) filters.city = city;
      if (state) filters.state = state;
      if (minRent) filters.minRent = parseFloat(minRent);
      if (maxRent) filters.maxRent = parseFloat(maxRent);
      if (type) filters.type = type;
      if (furnished !== undefined) filters.furnished = furnished === 'true';
      if (amenities) filters.amenities = amenities.split(',');
      if (genderPreference) filters.genderPreference = genderPreference;
      if (pets !== undefined) filters.pets = pets === 'true';
      if (smoking !== undefined) filters.smoking = smoking === 'true';

      // In a real implementation, perform complex search across properties and rooms
      const mockSearchResults = [
        {
          room: new Room({
            id: 'room_1',
            propertyId: 'prop_1',
            name: 'Cozy Downtown Room',
            type: 'bedroom',
            rent: { amount: 850, currency: 'USD' },
            furniture: { furnished: true },
            amenities: ['shared_bathroom', 'wifi', 'parking'],
            status: 'available'
          }).toJSON(),
          property: {
            id: 'prop_1',
            title: 'Downtown Shared House',
            address: { city: city || 'San Francisco', state: state || 'CA' },
            type: 'house'
          },
          matchScore: 85 // Calculated based on preferences
        },
        {
          room: new Room({
            id: 'room_2',
            propertyId: 'prop_2',
            name: 'Modern Apartment Room',
            type: 'bedroom',
            rent: { amount: 950, currency: 'USD' },
            furniture: { furnished: false },
            amenities: ['private_bathroom', 'balcony', 'gym'],
            status: 'available'
          }).toJSON(),
          property: {
            id: 'prop_2',
            title: 'Modern City Apartment',
            address: { city: city || 'San Francisco', state: state || 'CA' },
            type: 'apartment'
          },
          matchScore: 78
        }
      ];

      // Sort by match score
      mockSearchResults.sort((a, b) => b.matchScore - a.matchScore);

      const total = mockSearchResults.length;

      res.json(paginationResponse(
        mockSearchResults,
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
   * Get room energy data
   */
  async getRoomEnergyData(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { period = 'day' } = req.query;

      // In a real implementation, check if room has energy monitoring
      // const room = await RoomModel.findById(roomId);
      // if (!room.energyMonitoring.enabled) {
      //   throw new AppError('Energy monitoring not enabled for this room', 400);
      // }

      const energyData = await energyService.getEnergyStats(roomId, period);

      res.json(successResponse(
        energyData,
        'Room energy data retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update room availability
   */
  async updateRoomAvailability(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { isAvailable, availableFrom, tenantId } = req.body;

      // In a real implementation, update room availability
      const updatedRoom = {
        id: roomId,
        propertyId: propertyId,
        availability: {
          isAvailable: isAvailable,
          availableFrom: availableFrom ? new Date(availableFrom) : new Date()
        },
        currentTenant: tenantId || null,
        status: isAvailable ? 'available' : 'occupied',
        updatedAt: new Date()
      };

      logger.info('Room availability updated', {
        roomId: roomId,
        isAvailable: isAvailable,
        tenantId: tenantId
      });

      res.json(successResponse(
        updatedRoom,
        'Room availability updated successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Assign a tenant to a room
   */
  async assignTenant(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;
      const { tenantId } = req.body;

      const room = {
        id: roomId,
        propertyId,
        tenantId,
        status: 'occupied'
      };

      res.json(successResponse(
        room,
        'Tenant assigned successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Unassign tenant from a room
   */
  async unassignTenant(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      const room = {
        id: roomId,
        propertyId,
        tenantId: null,
        status: 'available'
      };

      res.json(successResponse(
        room,
        'Tenant unassigned successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get statistics for a single room
   */
  async getRoomStats(req, res, next) {
    try {
      const { propertyId, roomId } = req.params;

      // In a real implementation, compute stats
      const stats = {
        occupancyRate: 80,
        averageStayDuration: 6,
        monthlyRevenue: 1200,
        maintenanceRequests: 1,
        energyConsumption: 50
      };

      res.json(successResponse(
        stats,
        'Room statistics retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get room statistics
   */
  async getRoomStatistics(req, res, next) {
    try {
      const { propertyId } = req.params;

      // In a real implementation, calculate statistics from database
      const stats = {
        total: 4,
        available: 2,
        occupied: 1,
        maintenance: 1,
        averageRent: 975,
        occupancyRate: 75,
        averageSize: 156, // sq ft
        byType: {
          bedroom: 3,
          bathroom: 2,
          living_room: 1,
          kitchen: 1
        },
        byStatus: {
          available: 2,
          occupied: 1,
          maintenance: 1
        }
      };

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
