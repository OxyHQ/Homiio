#!/usr/bin/env node

/**
 * Migrate Address Data to New International Schema
 * 
 * This script migrates existing address documents to the new international schema format
 * with postal_code, countryCode, and new canonical fields.
 */

require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('crypto');

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/homiio');
    console.log('✅ Connected to database');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// Migrate address data to new international schema
async function migrateAddresses() {
  try {
    // Import models after connection
    const Address = require('../models/schemas/AddressSchema');
    
    console.log('\n🔧 Migrating address data...\n');
    
    // Find all properties with embedded addresses
    const properties = await Property.find({ 
      address: { $exists: true },
      addressId: { $exists: false } // Only migrate properties that haven't been migrated yet
    }).lean();
    
    console.log(`📊 Found ${properties.length} properties with embedded addresses to migrate`);
    
    if (properties.length === 0) {
      console.log('✅ All properties already migrated or no properties found');
      return;
    }

    let migratedCount = 0;
    let addressesCreated = 0;
    let addressesReused = 0;
    const addressMap = new Map(); // To track created addresses and avoid duplicates

    console.log('🚀 Starting migration...\n');

    for (const property of properties) {
      try {
        const addressData = property.address;
        
        // Create a unique key for this address
        const addressKey = `${addressData.street?.trim()}_${addressData.city?.trim()}_${addressData.state?.trim()}_${addressData.zipCode?.trim()}_${addressData.country?.trim() || 'USA'}`;
        
        let addressDoc;
        
        // Check if we've already created this address in this migration
        if (addressMap.has(addressKey)) {
          addressDoc = addressMap.get(addressKey);
          addressesReused++;
        } else {
          // Try to find existing address or create new one
          addressDoc = await Address.findOrCreate({
            street: addressData.street,
            city: addressData.city,
            state: addressData.state,
            zipCode: addressData.zipCode,
            country: addressData.country || 'USA',
            neighborhood: addressData.neighborhood,
            coordinates: addressData.coordinates,
            showAddressNumber: addressData.showAddressNumber !== undefined ? addressData.showAddressNumber : true
          });
          
          addressMap.set(addressKey, addressDoc);
          
          if (addressDoc.isNew !== false) {
            addressesCreated++;
          } else {
            addressesReused++;
          }
        }

        // Update property to reference the address
        await Property.updateOne(
          { _id: property._id },
          { 
            $set: { addressId: addressDoc._id },
            $unset: { address: 1 }
          }
        );

        migratedCount++;
        
        if (migratedCount % 100 === 0) {
          console.log(`📈 Progress: ${migratedCount}/${properties.length} properties migrated`);
        }
        
      } catch (error) {
        console.error(`❌ Failed to migrate property ${property._id}:`, error.message);
      }
    }
    
    console.log('\n📝 Migration summary:', {
      propertiesMigrated: migratedCount,
      addressesCreated: addressesCreated,
      addressesReused: addressesReused,
      totalProperties: properties.length
    });
    
    // Verify migration
    const propertiesWithEmbeddedAddress = await Property.find({ 
      address: { $exists: true }
    }).countDocuments();
    
    const propertiesWithAddressId = await Property.find({ 
      addressId: { $exists: true }
    }).countDocuments();
    
    console.log(`\n✅ Verification:`);
    console.log(`   Properties with embedded address: ${propertiesWithEmbeddedAddress}`);
    console.log(`   Properties with addressId reference: ${propertiesWithAddressId}`);
    console.log(`   Total addresses in collection: ${await Address.countDocuments()}`);
    
    if (propertiesWithEmbeddedAddress === 0 && propertiesWithAddressId > 0) {
      console.log('🎉 Migration completed successfully!');
    } else {
      console.log('⚠️ Migration may be incomplete - please review the results');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Check migration status
async function checkMigrationStatus() {
  try {
    const Property = require('../models/schemas/PropertySchema');
    const Address = require('../models/schemas/AddressSchema');
    
    console.log('\n📊 Migration Status:\n');
    
    const totalProperties = await Property.countDocuments();
    const propertiesWithEmbeddedAddress = await Property.find({ 
      address: { $exists: true }
    }).countDocuments();
    const propertiesWithAddressId = await Property.find({ 
      addressId: { $exists: true }
    }).countDocuments();
    const totalAddresses = await Address.countDocuments();
    
    console.log(`Total properties: ${totalProperties}`);
    console.log(`Properties with embedded address: ${propertiesWithEmbeddedAddress}`);
    console.log(`Properties with addressId reference: ${propertiesWithAddressId}`);
    console.log(`Total addresses in collection: ${totalAddresses}`);
    
    if (propertiesWithEmbeddedAddress > 0) {
      console.log('\n⚠️ Some properties still have embedded addresses - migration needed');
      return false;
    } else if (propertiesWithAddressId === totalProperties && totalAddresses > 0) {
      console.log('\n✅ Migration appears to be complete');
      return true;
    } else {
      console.log('\n❓ Migration status unclear - please review');
      return false;
    }
    
  } catch (error) {
    console.error('❌ Status check failed:', error.message);
    return false;
  }
}

// Main execution
async function main() {
  try {
    await connectDB();
    
    const command = process.argv[2];
    
    if (command === 'status') {
      await checkMigrationStatus();
    } else if (command === 'migrate') {
      await migrateAddresses();
    } else {
      console.log('Usage:');
      console.log('  node migrate-addresses.js status  - Check migration status');
      console.log('  node migrate-addresses.js migrate - Run the migration');
    }
    
  } catch (error) {
    console.error('❌ Script failed:', error.message);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from database');
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { migrateAddresses, checkMigrationStatus };