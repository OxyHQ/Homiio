#!/usr/bin/env node

/**
 * Migrate Address Schema to International Format
 * 
 * This script updates existing Address documents to use the new international schema
 * with postal_code, countryCode, and normalized keys.
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

// Update existing addresses to new schema format
async function migrateToInternationalSchema() {
  try {
    const Address = require('../models/schemas/AddressSchema');
    
    console.log('\n🔧 Migrating addresses to international schema...\n');
    
    // Find all addresses that need migration
    const addresses = await Address.find({
      $or: [
        { zipCode: { $exists: true } }, // Has old zipCode field
        { postal_code: { $exists: false } }, // Missing postal_code
        { countryCode: { $exists: false } }, // Missing countryCode
        { normalizedKey: { $exists: false } } // Missing normalizedKey
      ]
    });
    
    console.log(`📊 Found ${addresses.length} addresses to migrate`);
    
    if (addresses.length === 0) {
      console.log('✅ All addresses already migrated');
      return;
    }

    let migrated = 0;
    let errors = 0;
    const duplicates = [];
    
    // Country code mapping
    const countryCodeMap = {
      'USA': 'US',
      'United States': 'US',
      'United States of America': 'US',
      'Canada': 'CA',
      'United Kingdom': 'GB',
      'Great Britain': 'GB',
      'England': 'GB',
      'Spain': 'ES',
      'España': 'ES',
      'France': 'FR',
      'Germany': 'DE',
      'Deutschland': 'DE',
      'Italy': 'IT',
      'Italia': 'IT',
      'Mexico': 'MX',
      'México': 'MX',
      'Brazil': 'BR',
      'Brasil': 'BR',
      'Argentina': 'AR',
      'Colombia': 'CO',
      'Chile': 'CL',
      'Peru': 'PE',
      'Perú': 'PE',
      'Portugal': 'PT',
      'Netherlands': 'NL',
      'Belgium': 'BE',
      'Austria': 'AT',
      'Switzerland': 'CH',
      'Sweden': 'SE',
      'Norway': 'NO',
      'Denmark': 'DK',
      'Finland': 'FI'
    };

    console.log('🚀 Starting migration...\n');

    for (const address of addresses) {
      try {
        const updates = {};
        const unsetFields = {};
        
        // Migrate zipCode to postal_code
        if (address.zipCode && !address.postal_code) {
          updates.postal_code = address.zipCode;
          unsetFields.zipCode = 1;
        }
        
        // Add countryCode if missing
        if (!address.countryCode) {
          const country = address.country || 'USA';
          updates.countryCode = countryCodeMap[country] || country.substring(0, 2).toUpperCase();
        }
        
        // Initialize new fields
        if (!address.address_lines) {
          updates.address_lines = [];
        }
        
        if (!address.extras) {
          updates.extras = {};
        }
        
        // Compute normalized key
        const keyFields = [
          address.street?.toLowerCase().trim(),
          address.number?.toLowerCase().trim(),
          address.unit?.toLowerCase().trim(),
          address.building_name?.toLowerCase().trim(),
          address.block?.toLowerCase().trim(),
          address.city?.toLowerCase().trim(),
          address.state?.toLowerCase().trim(),
          (updates.postal_code || address.postal_code || address.zipCode)?.toLowerCase().trim(),
          (updates.countryCode || address.countryCode)?.toUpperCase()
        ].filter(field => field && field.length > 0);
        
        const keyString = keyFields.join('|');
        const normalizedKey = crypto.createHash('sha1').update(keyString).digest('hex');
        
        // Check for duplicate normalized keys
        const existingAddress = await Address.findOne({ 
          normalizedKey,
          _id: { $ne: address._id }
        });
        
        if (existingAddress) {
          duplicates.push({
            existing: existingAddress._id,
            duplicate: address._id,
            normalizedKey,
            address: `${address.street}, ${address.city}`
          });
          console.log(`⚠️ Duplicate address found: ${address.street}, ${address.city} (${address._id})`);
          continue;
        }
        
        updates.normalizedKey = normalizedKey;
        
        // Perform the update
        const updateQuery = { $set: updates };
        if (Object.keys(unsetFields).length > 0) {
          updateQuery.$unset = unsetFields;
        }
        
        await Address.updateOne({ _id: address._id }, updateQuery);
        migrated++;
        
        if (migrated % 100 === 0) {
          console.log(`📈 Progress: ${migrated}/${addresses.length} addresses migrated`);
        }
        
      } catch (error) {
        console.error(`❌ Error migrating address ${address._id}:`, error.message);
        errors++;
      }
    }
    
    console.log('\n📝 Migration summary:', {
      addressesToMigrate: addresses.length,
      addressesMigrated: migrated,
      errors: errors,
      duplicatesFound: duplicates.length
    });
    
    if (duplicates.length > 0) {
      console.log('\n⚠️ Duplicate addresses found:');
      duplicates.forEach((dup, index) => {
        console.log(`${index + 1}. ${dup.address} (${dup.duplicate}) - duplicate of ${dup.existing}`);
      });
      console.log('\n💡 You may want to merge these duplicates manually.');
    }
    
    // Update database indexes
    console.log('\n🔧 Updating database indexes...');
    
    try {
      // Drop old indexes
      await Address.collection.dropIndex('street_1_city_1_state_1_zipCode_1').catch(() => {
        console.log('   Old unique index not found (may have been already removed)');
      });
      
      await Address.collection.dropIndex('zipCode_1').catch(() => {
        console.log('   Old zipCode index not found');
      });
      
      console.log('   ✅ Old indexes removed');
    } catch (error) {
      console.log('   ⚠️ Error removing old indexes:', error.message);
    }
    
    // Verify new indexes exist (they should be created automatically by schema)
    const indexes = await Address.collection.indexes();
    const hasNormalizedKeyIndex = indexes.some(idx => idx.key && idx.key.normalizedKey);
    const hasPostalCodeIndex = indexes.some(idx => idx.key && idx.key.postal_code);
    
    console.log(`   Normalized key index: ${hasNormalizedKeyIndex ? '✅' : '❌'}`);
    console.log(`   Postal code index: ${hasPostalCodeIndex ? '✅' : '❌'}`);
    
    console.log('\n🎉 Schema migration completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  }
}

// Check migration status
async function checkSchemaStatus() {
  try {
    const Address = require('../models/schemas/AddressSchema');
    
    console.log('\n📊 Schema Migration Status:\n');
    
    const totalAddresses = await Address.countDocuments();
    const oldSchemaAddresses = await Address.countDocuments({ zipCode: { $exists: true } });
    const newSchemaAddresses = await Address.countDocuments({ postal_code: { $exists: true } });
    const withCountryCode = await Address.countDocuments({ countryCode: { $exists: true } });
    const withNormalizedKey = await Address.countDocuments({ normalizedKey: { $exists: true } });
    
    console.log(`Total addresses: ${totalAddresses}`);
    console.log(`Addresses with old zipCode field: ${oldSchemaAddresses}`);
    console.log(`Addresses with new postal_code field: ${newSchemaAddresses}`);
    console.log(`Addresses with countryCode: ${withCountryCode}`);
    console.log(`Addresses with normalizedKey: ${withNormalizedKey}`);
    
    if (oldSchemaAddresses === 0 && newSchemaAddresses === totalAddresses && 
        withCountryCode === totalAddresses && withNormalizedKey === totalAddresses) {
      console.log('\n✅ All addresses migrated to new schema');
      return true;
    } else {
      console.log('\n⚠️ Some addresses still need migration');
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
      await checkSchemaStatus();
    } else if (command === 'migrate') {
      await migrateToInternationalSchema();
    } else {
      console.log('Usage:');
      console.log('  node migrate-address-schema.js status  - Check migration status');
      console.log('  node migrate-address-schema.js migrate - Run the schema migration');
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

module.exports = { migrateToInternationalSchema, checkSchemaStatus };
