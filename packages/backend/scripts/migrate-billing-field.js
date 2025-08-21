#!/usr/bin/env node

/**
 * Migrate Billing Field
 * 
 * This script adds the billing field to existing profiles that don't have it.
 */

require('dotenv').config();
const mongoose = require('mongoose');

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

// Migrate billing field
async function migrateBillingField() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🔧 Migrating billing field...\n');
    
    // Find profiles without billing field
    const profilesWithoutBilling = await Profile.find({ 
      $or: [
        { billing: { $exists: false } },
        { billing: null }
      ]
    }).lean();
    
    console.log(`📊 Found ${profilesWithoutBilling.length} profiles without billing field`);
    
    if (profilesWithoutBilling.length === 0) {
      console.log('✅ All profiles already have billing field');
      return;
    }
    
    // Add billing field to profiles that don't have it
    const result = await Profile.updateMany(
      { 
        $or: [
          { billing: { $exists: false } },
          { billing: null }
        ]
      },
      {
        $set: {
          billing: {
            plusActive: false,
            fileCredits: 0,
            processedSessions: []
          }
        }
      }
    );
    
    console.log('📝 Migration result:', {
      matchedCount: result.matchedCount,
      modifiedCount: result.modifiedCount,
      upsertedCount: result.upsertedCount
    });
    
    // Verify migration
    const profilesAfterMigration = await Profile.find({ 
      $or: [
        { billing: { $exists: false } },
        { billing: null }
      ]
    }).countDocuments();
    
    console.log(`✅ Profiles without billing field after migration: ${profilesAfterMigration}`);
    
    if (profilesAfterMigration === 0) {
      console.log('🎉 Migration completed successfully!');
    } else {
      console.log('⚠️ Some profiles still missing billing field');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
  }
}

// Check billing field status
async function checkBillingFieldStatus() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🔍 Checking billing field status...\n');
    
    const totalProfiles = await Profile.countDocuments();
    const profilesWithBilling = await Profile.countDocuments({ 
      billing: { $exists: true, $ne: null }
    });
    const profilesWithoutBilling = await Profile.countDocuments({ 
      $or: [
        { billing: { $exists: false } },
        { billing: null }
      ]
    });
    
    console.log('📊 Billing field status:');
    console.log(`   Total profiles: ${totalProfiles}`);
    console.log(`   With billing field: ${profilesWithBilling}`);
    console.log(`   Without billing field: ${profilesWithoutBilling}`);
    
    // Check profiles by type
    const profilesByType = await Profile.aggregate([
      {
        $group: {
          _id: '$profileType',
          total: { $sum: 1 },
          withBilling: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$billing', null] }, { $ne: ['$billing', undefined] }] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);
    
    console.log('\n📋 By profile type:');
    profilesByType.forEach(type => {
      console.log(`   ${type._id}: ${type.withBilling}/${type.total} have billing field`);
    });
    
  } catch (error) {
    console.error('❌ Status check failed:', error.message);
  }
}

// Main execution
async function main() {
  console.log('🔧 Billing Field Migration');
  console.log('==========================\n');
  
  await connectDB();
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'migrate':
      await migrateBillingField();
      break;
      
    case 'status':
      await checkBillingFieldStatus();
      break;
      
    default:
      await checkBillingFieldStatus();
      console.log('\n---\n');
      await migrateBillingField();
      break;
  }
  
  await mongoose.disconnect();
  console.log('\n✅ Database connection closed');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { migrateBillingField, checkBillingFieldStatus };
