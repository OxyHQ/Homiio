// Script to remove profileId from existing external properties
// Usage: ts-node --transpile-only scripts/cleanup-external-profileId.ts

require('dotenv').config();
import database from '../database/connection';
const Property = require('../models/schemas/PropertySchema');

(async () => {
  try {
    await database.connect();
    const res = await Property.updateMany({ isExternal: true, profileId: { $exists: true, $ne: null } }, { $unset: { profileId: '' } });
    console.log('Cleanup result:', res.modifiedCount, 'documents updated');
  } catch (e:any) {
    console.error('Cleanup failed:', e.message);
  } finally {
    process.exit(0);
  }
})();
