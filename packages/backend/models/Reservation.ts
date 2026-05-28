/**
 * Reservation Model
 * Re-exports the Mongoose model defined in schemas/ReservationSchema.ts so it
 * can be imported from a stable path. Pairs with Lease/ViewingRequest models.
 */

import type { Model } from 'mongoose';

const ReservationModel = require('./schemas/ReservationSchema') as Model<unknown>;

export default ReservationModel;
