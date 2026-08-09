#!/usr/bin/env node

/**
 * Test Subscription Save
 * 
 * This script tests if subscriptions are being saved to the database correctly.
 */

require('dotenv').config();
const mongoose = require('mongoose');

// Connect to database
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/homiio');
    console.log('✅ Connected to database');
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

// Test subscription save
async function testSubscriptionSave() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🧪 Testing subscription save...\n');
    
    // Find a test profile
    const testProfile = await Profile.findOne().lean();
    if (!testProfile) {
      console.log('❌ No profiles found in database');
      return;
    }
    
    console.log('📋 Test profile found:', {
      id: testProfile._id,
      oxyUserId: testProfile.oxyUserId,
      hasBilling: !!testProfile.billing,
      plusActive: testProfile.billing?.plusActive || false
    });
    
    // Test manual activation
    console.log('\n🔧 Testing manual subscription activation...');
    
    const sessionId = `test_session_${Date.now()}`;
    const updateResult = await Profile.updateOne(
      { _id: testProfile._id },
      {
        $set: {
          'billing.plusActive': true,
          'billing.plusSince': new Date(),
          'billing.lastPaymentAt': new Date(),
          'billing.plusStripeSubscriptionId': `sub_test_${Date.now()}`
        },
        $addToSet: { 'billing.processedSessions': sessionId },
        $setOnInsert: { 'billing.fileCredits': 0 }
      }
    );
    
    console.log('📝 Update result:', updateResult);
    
    // Verify the update
    const updatedProfile = await Profile.findById(testProfile._id).select('billing').lean();
    console.log('\n✅ Updated profile billing:', {
      plusActive: updatedProfile.billing?.plusActive,
      plusSince: updatedProfile.billing?.plusSince,
      lastPaymentAt: updatedProfile.billing?.lastPaymentAt,
      plusStripeSubscriptionId: updatedProfile.billing?.plusStripeSubscriptionId,
      processedSessions: updatedProfile.billing?.processedSessions?.length || 0
    });
    
    if (updatedProfile.billing?.plusActive) {
      console.log('🎉 SUCCESS: Subscription was saved to database!');
    } else {
      console.log('❌ FAILED: Subscription was not saved to database');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
}

// Test billing object creation
async function testBillingObjectCreation() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🧪 Testing billing object creation...\n');
    
    // Find a profile without billing
    const profileWithoutBilling = await Profile.findOne({ 'billing': { $exists: false } }).lean();
    if (!profileWithoutBilling) {
      console.log('ℹ️ All profiles already have billing objects');
      return;
    }
    
    console.log('📋 Profile without billing found:', {
      id: profileWithoutBilling._id,
      oxyUserId: profileWithoutBilling.oxyUserId
    });
    
    // Create billing object
    const result = await Profile.updateOne(
      { _id: profileWithoutBilling._id },
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
    
    console.log('📝 Billing object creation result:', result);
    
    // Verify billing object was created
    const updatedProfile = await Profile.findById(profileWithoutBilling._id).select('billing').lean();
    console.log('\n✅ Billing object created:', {
      hasBilling: !!updatedProfile.billing,
      plusActive: updatedProfile.billing?.plusActive,
      fileCredits: updatedProfile.billing?.fileCredits,
      processedSessions: updatedProfile.billing?.processedSessions?.length || 0
    });
    
  } catch (error) {
    console.error('❌ Billing object creation test failed:', error.message);
  }
}

// Main execution
async function main() {
  console.log('🧪 Subscription Save Test');
  console.log('========================\n');
  
  await connectDB();
  
  await testBillingObjectCreation();
  await testSubscriptionSave();
  
  await mongoose.disconnect();
  console.log('\n✅ Database connection closed');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { testSubscriptionSave, testBillingObjectCreation };
