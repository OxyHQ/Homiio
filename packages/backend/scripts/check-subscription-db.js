#!/usr/bin/env node

/**
 * Check Subscription Database Status
 * 
 * This script directly queries the database to check if subscriptions
 * are being saved correctly.
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

// Check all profiles with billing data
async function checkAllBillingProfiles() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🔍 Checking all profiles with billing data...\n');
    
    const profiles = await Profile.find({ 'billing.plusActive': { $exists: true } })
      .select('oxyUserId billing.plusActive billing.plusSince billing.plusStripeSubscriptionId billing.fileCredits billing.lastPaymentAt billing.processedSessions')
      .lean();
    
    if (profiles.length === 0) {
      console.log('❌ No profiles found with billing data');
      return;
    }
    
    console.log(`📊 Found ${profiles.length} profiles with billing data:\n`);
    
    profiles.forEach((profile, index) => {
      console.log(`${index + 1}. User: ${profile.oxyUserId}`);
      console.log(`   Plus Active: ${profile.billing?.plusActive ? '✅ YES' : '❌ NO'}`);
      console.log(`   Plus Since: ${profile.billing?.plusSince || 'N/A'}`);
      console.log(`   Stripe Subscription ID: ${profile.billing?.plusStripeSubscriptionId || 'N/A'}`);
      console.log(`   File Credits: ${profile.billing?.fileCredits || 0}`);
      console.log(`   Last Payment: ${profile.billing?.lastPaymentAt || 'N/A'}`);
      console.log(`   Processed Sessions: ${profile.billing?.processedSessions?.length || 0}`);
      console.log('');
    });
    
    // Summary
    const activeSubscriptions = profiles.filter(p => p.billing?.plusActive);
    const inactiveSubscriptions = profiles.filter(p => !p.billing?.plusActive);
    
    console.log('📈 Summary:');
    console.log(`   Total profiles with billing: ${profiles.length}`);
    console.log(`   Active Plus subscriptions: ${activeSubscriptions.length}`);
    console.log(`   Inactive Plus subscriptions: ${inactiveSubscriptions.length}`);
    
  } catch (error) {
    console.error('❌ Error checking profiles:', error.message);
  }
}

// Check specific user by oxyUserId
async function checkUserBilling(oxyUserId) {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log(`\n🔍 Checking billing for user: ${oxyUserId}\n`);
    
    const profile = await Profile.findOne({ oxyUserId })
      .select('oxyUserId billing.plusActive billing.plusSince billing.plusStripeSubscriptionId billing.fileCredits billing.lastPaymentAt billing.processedSessions')
      .lean();
    
    if (!profile) {
      console.log('❌ Profile not found for this user');
      return;
    }
    
    console.log('📋 Profile found:');
    console.log(`   User ID: ${profile.oxyUserId}`);
    console.log(`   Plus Active: ${profile.billing?.plusActive ? '✅ YES' : '❌ NO'}`);
    console.log(`   Plus Since: ${profile.billing?.plusSince || 'N/A'}`);
    console.log(`   Stripe Subscription ID: ${profile.billing?.plusStripeSubscriptionId || 'N/A'}`);
    console.log(`   File Credits: ${profile.billing?.fileCredits || 0}`);
    console.log(`   Last Payment: ${profile.billing?.lastPaymentAt || 'N/A'}`);
    console.log(`   Processed Sessions: ${profile.billing?.processedSessions?.length || 0}`);
    
    if (profile.billing?.processedSessions?.length > 0) {
      console.log(`   Session IDs: ${profile.billing.processedSessions.join(', ')}`);
    }
    
  } catch (error) {
    console.error('❌ Error checking user billing:', error.message);
  }
}

// Check recent billing updates
async function checkRecentBillingUpdates() {
  try {
    const Profile = mongoose.model('Profile');
    
    console.log('\n🔍 Checking recent billing updates (last 24 hours)...\n');
    
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const profiles = await Profile.find({
      $or: [
        { 'billing.lastPaymentAt': { $gte: yesterday } },
        { 'billing.plusSince': { $gte: yesterday } }
      ]
    })
    .select('oxyUserId billing.plusActive billing.plusSince billing.plusStripeSubscriptionId billing.lastPaymentAt billing.processedSessions')
    .lean();
    
    if (profiles.length === 0) {
      console.log('❌ No recent billing updates found');
      return;
    }
    
    console.log(`📊 Found ${profiles.length} profiles with recent billing updates:\n`);
    
    profiles.forEach((profile, index) => {
      console.log(`${index + 1}. User: ${profile.oxyUserId}`);
      console.log(`   Plus Active: ${profile.billing?.plusActive ? '✅ YES' : '❌ NO'}`);
      console.log(`   Plus Since: ${profile.billing?.plusSince || 'N/A'}`);
      console.log(`   Last Payment: ${profile.billing?.lastPaymentAt || 'N/A'}`);
      console.log(`   Processed Sessions: ${profile.billing?.processedSessions?.length || 0}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error checking recent updates:', error.message);
  }
}

// Main execution
async function main() {
  console.log('🔍 Subscription Database Checker');
  console.log('================================\n');
  
  await connectDB();
  
  const args = process.argv.slice(2);
  const command = args[0];
  
  switch (command) {
    case 'user':
      const userId = args[1];
      if (!userId) {
        console.log('❌ Please provide a user ID: node check-subscription-db.js user <userId>');
        process.exit(1);
      }
      await checkUserBilling(userId);
      break;
      
    case 'recent':
      await checkRecentBillingUpdates();
      break;
      
    default:
      await checkAllBillingProfiles();
      break;
  }
  
  await mongoose.disconnect();
  console.log('\n✅ Database connection closed');
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { checkAllBillingProfiles, checkUserBilling, checkRecentBillingUpdates };
