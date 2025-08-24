/**
 * Address Routes
 * API endpoints for address management
 */

import { Router } from 'express';
import {
  getAddressById,
  searchAddresses,
  createAddress,
  updateAddress,
  deleteAddress,
  getNearbyAddresses
} from '../controllers/addressController';

const router = Router();

// Search and location-based routes (must come before :id route)
router.get('/search', searchAddresses);
router.get('/nearby', getNearbyAddresses);

// CRUD operations
router.get('/:id', getAddressById);
router.post('/', createAddress);
router.put('/:id', updateAddress);
router.delete('/:id', deleteAddress);

export default router;
