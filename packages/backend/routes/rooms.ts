/**
 * Room Routes
 * API routes for room management within properties
 */

const express = require('express');
const { roomController } = require('../controllers');
const { validation, asyncHandler } = require('../middlewares');

module.exports = function() {
  const router = express.Router({ mergeParams: true }); // mergeParams to access propertyId

  // Public routes
  router.get('/search', validation.validatePagination, asyncHandler(roomController.searchRooms));

  // Room CRUD operations within a property
  router.post('/', 
    validation.validateId('propertyId'),
    asyncHandler(roomController.createRoom)
  );

  router.get('/', 
    validation.validateId('propertyId'),
    validation.validatePagination,
    asyncHandler(roomController.getPropertyRooms)
  );

  router.get('/statistics',
    validation.validateId('propertyId'),
    asyncHandler(roomController.getRoomStatistics)
  );

  router.get('/:roomId/stats',
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.getRoomStats)
  );

  router.get('/:roomId', 
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.getRoomById)
  );

  router.put('/:roomId', 
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.updateRoom)
  );

  router.delete('/:roomId', 
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.deleteRoom)
  );

  // Room availability management
  router.patch('/:roomId/availability',
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.updateRoomAvailability)
  );

  router.post('/:roomId/assign',
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.assignTenant)
  );

  router.post('/:roomId/unassign',
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    asyncHandler(roomController.unassignTenant)
  );

  // Room energy data
  router.get('/:roomId/energy',
    validation.validateId('propertyId'),
    validation.validateId('roomId'),
    validation.validateDateRange,
    asyncHandler(roomController.getRoomEnergyData)
  );

  return router;
};
