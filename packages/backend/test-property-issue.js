#!/usr/bin/env node

/**
 * Test script to check current property API responses
 * and identify the address field issue
 */

const mongoose = require('mongoose');

// Mock environment for testing - using in-memory database for testing
const MONGODB_URI = 'mongodb://localhost:27017/homiio-test';

async function testPropertyAPI() {
  try {
    console.log('🔧 Testing Property API responses...\n');
    
    // Connect to database
    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to database');
    
    // Import models
    const Property = require('./models/schemas/PropertySchema');
    const Address = require('./models/schemas/AddressSchema');
    
    // Check current state
    const totalProperties = await Property.countDocuments();
    const propertiesWithEmbeddedAddress = await Property.countDocuments({ address: { $exists: true } });
    const propertiesWithAddressId = await Property.countDocuments({ addressId: { $exists: true } });
    const totalAddresses = await Address.countDocuments();
    
    console.log('\n📊 Current Database State:');
    console.log(`   Total properties: ${totalProperties}`);
    console.log(`   Properties with embedded address: ${propertiesWithEmbeddedAddress}`);
    console.log(`   Properties with addressId reference: ${propertiesWithAddressId}`);
    console.log(`   Total addresses in collection: ${totalAddresses}`);
    
    if (totalProperties === 0) {
      console.log('\n⚠️  No properties found. Creating a test property...');
      
      // Create a test address
      const testAddress = new Address({
        street: '123 Test Street',
        city: 'Test City',
        state: 'CA',
        zipCode: '12345',
        country: 'USA',
        coordinates: {
          type: 'Point',
          coordinates: [-122.4194, 37.7749] // San Francisco coordinates
        }
      });
      await testAddress.save();
      console.log(`   ✅ Created test address: ${testAddress._id}`);
      
      // Create a test property
      const testProperty = new Property({
        title: 'Test Property',
        description: 'A test property for API testing',
        addressId: testAddress._id,
        type: 'apartment',
        bedrooms: 2,
        bathrooms: 1,
        rent: {
          amount: 2000,
          currency: 'USD'
        }
      });
      await testProperty.save();
      console.log(`   ✅ Created test property: ${testProperty._id}`);
    }
    
    // Test property retrieval with population
    console.log('\n🔍 Testing property retrieval...');
    
    const properties = await Property.find().populate('addressId').limit(3);
    
    console.log(`\n📋 Sample properties (${properties.length} found):`);
    
    properties.forEach((property, index) => {
      console.log(`\n   Property ${index + 1}:`);
      console.log(`   - ID: ${property._id}`);
      console.log(`   - Title: ${property.title || 'N/A'}`);
      console.log(`   - Address ID: ${property.addressId?._id || 'N/A'}`);
      console.log(`   - Address field: ${property.address ? 'EXISTS' : 'MISSING'}`);
      console.log(`   - AddressId populated: ${property.addressId?.street ? 'YES' : 'NO'}`);
      if (property.addressId?.street) {
        console.log(`   - Address street: ${property.addressId.street}`);
        console.log(`   - Address city: ${property.addressId.city}`);
      }
      
      // Test toJSON output
      const jsonOutput = property.toJSON();
      console.log(`   - JSON has 'address' field: ${jsonOutput.address ? 'YES' : 'NO'}`);
      console.log(`   - JSON has 'addressId' field: ${jsonOutput.addressId ? 'YES' : 'NO'}`);
      
      // Test virtual fields
      console.log(`   - fullAddress virtual: ${property.fullAddress || 'N/A'}`);
      console.log(`   - location virtual: ${property.location || 'N/A'}`);
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Note: This test requires a MongoDB connection. Skipping database tests.');
      console.log('    The issue can still be identified by examining the schema configuration.');
      return await testSchemaConfiguration();
    }
    console.error(error.stack);
  } finally {
    try {
      await mongoose.disconnect();
      console.log('\n✅ Disconnected from database');
    } catch (e) {
      // Ignore disconnect errors
    }
  }
}

async function testSchemaConfiguration() {
  console.log('\n🔧 Testing Schema Configuration (no DB connection needed)...\n');
  
  // Import models to check schema configuration
  const Property = require('./models/schemas/PropertySchema');
  const Address = require('./models/schemas/AddressSchema');
  
  console.log('📋 Schema Analysis:');
  
  // Check Property schema fields
  const propertySchema = Property.schema;
  console.log(`   - Property has 'addressId' field: ${propertySchema.paths.addressId ? 'YES' : 'NO'}`);
  console.log(`   - Property has 'address' field: ${propertySchema.paths.address ? 'YES' : 'NO'}`);
  
  // Check virtuals
  const virtuals = Object.keys(propertySchema.virtuals);
  console.log(`   - Property virtuals: ${virtuals.join(', ')}`);
  
  // Check toJSON configuration
  const toJSONOptions = propertySchema.options.toJSON;
  console.log(`   - toJSON virtuals enabled: ${toJSONOptions?.virtuals ? 'YES' : 'NO'}`);
  console.log(`   - toJSON transform function: ${toJSONOptions?.transform ? 'EXISTS' : 'MISSING'}`);
  
  // Create mock instances to test virtuals (without DB)
  const mockProperty = new Property({
    title: 'Mock Property',
    type: 'apartment',
    rent: { amount: 1000, currency: 'USD' }
  });
  
  // Mock populated addressId
  mockProperty.addressId = {
    _id: 'mock_address_id',
    street: '123 Mock Street',
    city: 'Mock City',
    state: 'CA',
    zipCode: '12345'
  };
  
  console.log('\n🧪 Testing virtuals with mock data:');
  console.log(`   - fullAddress virtual: ${mockProperty.fullAddress || 'N/A'}`);
  console.log(`   - location virtual: ${mockProperty.location || 'N/A'}`);
  
  // Test toJSON
  const jsonOutput = mockProperty.toJSON();
  console.log(`   - JSON has 'address' field: ${jsonOutput.address ? 'YES' : 'NO'}`);
  console.log(`   - JSON has 'addressId' field: ${jsonOutput.addressId ? 'YES' : 'NO'}`);
  
  console.log('\n❗ Issue Identified:');
  console.log('   The virtual fields expect "this.address" but the populated field is "this.addressId".');
  console.log('   The toJSON transform needs to alias populated addressId to address for compatibility.');
}

testPropertyAPI().catch(console.error);