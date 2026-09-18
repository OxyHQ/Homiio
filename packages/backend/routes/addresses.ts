/**
 * Address Routes
 * API endpoints for address management
 *
 * Mounted by `routes/index.ts` BEHIND the session middleware, so every handler
 * here has a signed-in caller — which is not the same as an authorised one. A
 * canonical address is the permanent identity of a dwelling (ADR 0001), so the
 * write surface is deliberately narrow: `PUT` corrects only non-identity
 * attributes and only for a caller with a recorded relation to the place, the
 * identity fields are proposed rather than written, and there is **no DELETE** —
 * ADR 0001 §2.1.7 (a duplicate is recorded, never discarded). See
 * `controllers/addressController.ts` for each rule and its reason.
 */

import { Router } from 'express';
import {
  getAddressById,
  searchAddresses,
  createAddress,
  updateAddress,
  getNearbyAddresses,
  proposeCorrection,
  listCorrections,
  withdrawCorrection,
} from '../controllers/addressController';

const router = Router();

// Search and location-based routes (must come before :id route)
router.get('/search', searchAddresses);
router.get('/nearby', getNearbyAddresses);

// Correction proposals (ADR 0001 §8.1). Declared before the bare `/:id` routes
// so the literal `corrections` segment is unambiguous.
router.get('/:id/corrections', listCorrections);
router.post('/:id/corrections', proposeCorrection);
router.delete('/:id/corrections/:proposalId', withdrawCorrection);

// CRUD operations
router.get('/:id', getAddressById);
router.post('/', createAddress);
router.put('/:id', updateAddress);

export default router;
