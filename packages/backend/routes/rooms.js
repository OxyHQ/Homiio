/**
 * Room Routes
 * API routes for room management within properties
 */

const express = require('express');
const { roomController } = require('../controllers');
const { auth, validation } = require('../middlewares');

const router = express.Router({ mergeParams: true }); // mergeParams to access propertyId

// Public routes
router.get('/search', validation.validatePagination, roomController.searchRooms);

// Protected routes (authentication required)
router.use(auth.verifyToken);

// Room CRUD operations within a property
router.post('/', 
  validation.validateId('propertyId'),
  auth.verifyPropertyOwnership,
  roomController.createRoom
);

router.get('/', 
  validation.validateId('propertyId'),
  validation.validatePagination,
  roomController.getPropertyRooms
);

router.get('/statistics',
  validation.validateId('propertyId'),
  auth.verifyPropertyOwnership,
  roomController.getRoomStatistics
);

router.get('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.getRoomById
);

router.put('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  auth.verifyPropertyOwnership,
  roomController.updateRoom
);

router.delete('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  auth.verifyPropertyOwnership,
  roomController.deleteRoom
);

// Room availability management
router.patch('/:roomId/availability',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  auth.verifyPropertyOwnership,
  roomController.updateRoomAvailability
);

// Room energy data
router.get('/:roomId/energy',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  validation.validateDateRange,
  roomController.getRoomEnergyData
);

module.exports = router;
