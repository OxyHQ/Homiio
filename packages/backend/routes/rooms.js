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

// Room CRUD operations within a property
router.post('/', 
  validation.validateId('propertyId'),
  roomController.createRoom
);

router.get('/', 
  validation.validateId('propertyId'),
  validation.validatePagination,
  roomController.getPropertyRooms
);

router.get('/statistics',
  validation.validateId('propertyId'),
  roomController.getRoomStatistics
);

router.get('/:roomId/stats',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.getRoomStats
);

router.get('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.getRoomById
);

router.put('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.updateRoom
);

router.delete('/:roomId', 
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.deleteRoom
);

// Room availability management
router.patch('/:roomId/availability',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.updateRoomAvailability
);

router.post('/:roomId/assign',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.assignTenant
);

router.post('/:roomId/unassign',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  roomController.unassignTenant
);

// Room energy data
router.get('/:roomId/energy',
  validation.validateId('propertyId'),
  validation.validateId('roomId'),
  validation.validateDateRange,
  roomController.getRoomEnergyData
);

module.exports = router;
