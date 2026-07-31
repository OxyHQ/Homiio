/**
 * Room Routes
 * API routes for room management within properties
 */

import * as controllers from '../controllers';
import express from 'express';
import { asyncHandler } from '../middlewares';
const { roomController } = controllers;

export default function() {
  const router = express.Router();

  router.get('/', asyncHandler(roomController.getRooms));
  router.post('/', asyncHandler(roomController.createRoom));
  router.get('/:id', asyncHandler(roomController.getRoomById));
  router.put('/:id', asyncHandler(roomController.updateRoom));
  router.delete('/:id', asyncHandler(roomController.deleteRoom));

  return router;
};
