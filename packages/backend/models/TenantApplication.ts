/**
 * TenantApplication Model
 * Re-exports the Mongoose model defined in schemas/TenantApplicationSchema.ts
 * so it can be imported from a stable path. Pairs with Reservation/Lease models.
 */

import type { Model } from 'mongoose';

const TenantApplicationModel = require('./schemas/TenantApplicationSchema') as Model<unknown>;

export default TenantApplicationModel;
