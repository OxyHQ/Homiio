#!/usr/bin/env node

/**
 * Database Audit Script
 * Check for properties missing addressId references and migration status
 * 
 * Usage: node audit-database.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function auditDatabase() {
  try {
    console.log('🔍 Auditing Database for Address Migration Status...\n');
    
    // Connect to database
    const dbUrl = process.env.DATABASE_URL || process.env.MONGODB_URI || 'mongodb://localhost:27017/homiio';
    await mongoose.connect(dbUrl);
    console.log('✅ Connected to database');
    
    // Import models
    const Property = require('./models/schemas/PropertySchema');
    const Address = require('./models/schemas/AddressSchema');
    
    // Get current state
    const totalProperties = await Property.countDocuments();
    const propertiesWithEmbeddedAddress = await Property.countDocuments({ address: { $exists: true } });
    const propertiesWithAddressId = await Property.countDocuments({ addressId: { $exists: true } });
    const propertiesWithValidAddressId = await Property.countDocuments({ 
      addressId: { $exists: true, $ne: null } 
    });
    const totalAddresses = await Address.countDocuments();
    
    console.log('\n📊 Database Status:');
    console.log(`   Total properties: ${totalProperties}`);
    console.log(`   Properties with embedded address: ${propertiesWithEmbeddedAddress}`);
    console.log(`   Properties with addressId field: ${propertiesWithAddressId}`);
    console.log(`   Properties with valid addressId: ${propertiesWithValidAddressId}`);
    console.log(`   Total addresses in collection: ${totalAddresses}`);
    
    // Check for orphaned properties (no addressId and no embedded address)
    const orphanedProperties = await Property.countDocuments({
      $and: [
        { address: { $exists: false } },
        { addressId: { $exists: false } }
      ]
    });
    
    const propertiesWithNullAddressId = await Property.countDocuments({
      addressId: null
    });
    
    console.log('\n⚠️  Potential Issues:');
    console.log(`   Orphaned properties (no address data): ${orphanedProperties}`);
    console.log(`   Properties with null addressId: ${propertiesWithNullAddressId}`);
    
    // Check for properties with invalid addressId references
    if (propertiesWithValidAddressId > 0) {
      console.log('\n🔍 Checking addressId reference integrity...');
      
      const propertiesWithInvalidRefs = await Property.aggregate([
        { $match: { addressId: { $exists: true, $ne: null } } },
        {
          $lookup: {
            from: 'addresses',
            localField: 'addressId',
            foreignField: '_id',
            as: 'addressRef'
          }
        },
        { $match: { addressRef: { $size: 0 } } },
        { $count: 'invalidRefs' }
      ]);
      
      const invalidRefsCount = propertiesWithInvalidRefs[0]?.invalidRefs || 0;
      console.log(`   Properties with invalid addressId references: ${invalidRefsCount}`);
    }
    
    // Sample some properties to check their structure
    console.log('\n📋 Sample Properties:');
    const sampleProperties = await Property.find()
      .populate('addressId')
      .limit(3)
      .lean();
    
    sampleProperties.forEach((property, index) => {
      console.log(`\n   Property ${index + 1}:`);
      console.log(`   - ID: ${property._id}`);
      console.log(`   - Title: ${property.title || 'MISSING'}`);
      console.log(`   - Has embedded address: ${property.address ? 'YES' : 'NO'}`);
      console.log(`   - Has addressId: ${property.addressId ? 'YES' : 'NO'}`);
      console.log(`   - AddressId populated: ${property.addressId?._id ? 'YES' : 'NO'}`);
      if (property.addressId?.city) {
        console.log(`   - Address city: ${property.addressId.city}`);
      }
    });
    
    // Migration recommendations
    console.log('\n💡 Recommendations:');
    
    if (propertiesWithEmbeddedAddress > 0) {
      console.log(`   🔄 Run address migration for ${propertiesWithEmbeddedAddress} properties with embedded addresses`);
      console.log('      Command: node scripts/migrate-addresses.js migrate');
    }
    
    if (orphanedProperties > 0) {
      console.log(`   ⚠️  ${orphanedProperties} properties have no address data - these need manual attention`);
    }
    
    if (propertiesWithNullAddressId > 0) {
      console.log(`   🔧 ${propertiesWithNullAddressId} properties have null addressId - these need to be fixed`);
    }
    
    if (totalProperties === propertiesWithValidAddressId && totalAddresses > 0) {
      console.log('   ✅ All properties have valid addressId references - migration appears complete!');
    }
    
  } catch (error) {
    if (error.message.includes('ECONNREFUSED')) {
      console.log('❌ Cannot connect to database. Please check:');
      console.log('   - MongoDB is running');
      console.log('   - DATABASE_URL environment variable is set correctly');
      console.log('   - Connection string is valid');
    } else {
      console.error('❌ Audit failed:', error.message);
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n✅ Disconnected from database');
  }
}

auditDatabase().catch(console.error);