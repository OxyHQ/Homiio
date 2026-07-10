// Script to remove oxyUserId from existing external properties
// Usage: ts-node --transpile-only scripts/cleanup-external-oxyUserId.ts

require('dotenv').config();
import database from '../database/connection';
const Property = require('../models/schemas/PropertySchema');

(async () => {
  try {
    await database.connect();
    const res = await Property.updateMany({ isExternal: true, oxyUserId: { $exists: true, $ne: null } }, { $unset: { oxyUserId: '' } });
    console.log('Cleanup result:', res.modifiedCount, 'documents updated');
  } catch (e:any) {
    console.error('Cleanup failed:', e.message);
  } finally {
    process.exit(0);
  }
})();
