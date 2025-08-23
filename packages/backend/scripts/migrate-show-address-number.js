#!/usr/bin/env node

/**
 * Migration script to move showAddressNumber from Address back to Property level
 * This fixes the issue where showAddressNumber was incorrectly stored at address level
 * when it should be a property-level setting.
 */

const mongoose = require('mongoose');

async function migrateShowAddressNumber() {
  try {
    console.log('🔧 Starting showAddressNumber migration...\n');
    
    // Import models
    const Property = require('../models/schemas/PropertySchema');
    const Address = require('../models/schemas/AddressSchema');
    
    // Find all properties that don't have showAddressNumber set
    const properties = await Property.find({ 
      showAddressNumber: { $exists: false }
    }).populate('addressId');
    
    console.log(`📊 Found ${properties.length} properties without showAddressNumber field`);
    
    if (properties.length === 0) {
      console.log('✅ All properties already have showAddressNumber field');
      return;
    }
    
    let migrated = 0;
    
    for (const property of properties) {
      try {
        // Get showAddressNumber from the address, defaulting to true
        const showAddressNumber = property.addressId?.showAddressNumber !== undefined 
          ? property.addressId.showAddressNumber 
          : true;
        
        // Update property with showAddressNumber field
        await Property.updateOne(
          { _id: property._id },
          { $set: { showAddressNumber } }
        );
        
        migrated++;
        
        if (migrated % 50 === 0) {
          console.log(`📈 Progress: ${migrated}/${properties.length} properties migrated`);
        }
        
      } catch (error) {
        console.error(`❌ Failed to migrate property ${property._id}:`, error.message);
      }
    }
    
    console.log(`\n✅ Migration completed! Migrated ${migrated} properties`);
    
    // Optional: Clean up showAddressNumber from Address collection
    console.log('\n🧹 Note: You may want to remove showAddressNumber from Address schema');
    console.log('   and run a migration to remove it from existing address documents.');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

async function checkMigrationStatus() {
  try {
    const Property = require('../models/schemas/PropertySchema');
    
    const totalProperties = await Property.countDocuments();
    const propertiesWithShowAddressNumber = await Property.countDocuments({ 
      showAddressNumber: { $exists: true }
    });
    const propertiesWithoutShowAddressNumber = await Property.countDocuments({ 
      showAddressNumber: { $exists: false }
    });
    
    console.log('\n📊 Migration Status:');
    console.log(`   Total properties: ${totalProperties}`);
    console.log(`   Properties with showAddressNumber: ${propertiesWithShowAddressNumber}`);
    console.log(`   Properties without showAddressNumber: ${propertiesWithoutShowAddressNumber}`);
    
    if (propertiesWithoutShowAddressNumber === 0) {
      console.log('\n✅ Migration is complete - all properties have showAddressNumber field');
    } else {
      console.log('\n⚠️ Migration needed - some properties missing showAddressNumber field');
    }
    
  } catch (error) {
    console.error('❌ Status check failed:', error.message);
  }
}

// Main execution
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'status') {
    checkMigrationStatus();
  } else if (command === 'migrate') {
    migrateShowAddressNumber();
  } else {
    console.log('Usage: node migrate-show-address-number.js [status|migrate]');
    console.log('  status  - Check migration status');
    console.log('  migrate - Run the migration');
  }
}

module.exports = {
  migrateShowAddressNumber,
  checkMigrationStatus
};