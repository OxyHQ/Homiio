#!/usr/bin/env node

/**
 * Analyze the Property schema issue without DB connection
 */

console.log('🔧 Analyzing Property Schema Issue...\n');

// Test the issue by reading the schema files directly
const fs = require('fs');
const path = require('path');

try {
  // Read PropertySchema file
  const propertySchemaPath = path.join(__dirname, 'models/schemas/PropertySchema.ts');
  const propertySchemaContent = fs.readFileSync(propertySchemaPath, 'utf8');
  
  console.log('📋 Property Schema Analysis:');
  
  // Check for addressId field
  const hasAddressId = propertySchemaContent.includes('addressId:');
  console.log(`   - Has addressId field: ${hasAddressId ? 'YES' : 'NO'}`);
  
  // Check for embedded address field
  const hasEmbeddedAddress = propertySchemaContent.includes('address:') && 
                           propertySchemaContent.includes('street:') &&
                           !propertySchemaContent.includes('addressId:');
  console.log(`   - Has embedded address field: ${hasEmbeddedAddress ? 'YES' : 'NO'}`);
  
  // Check virtual fields
  const hasFullAddressVirtual = propertySchemaContent.includes("virtual('fullAddress')");
  const hasLocationVirtual = propertySchemaContent.includes("virtual('location')");
  console.log(`   - Has fullAddress virtual: ${hasFullAddressVirtual ? 'YES' : 'NO'}`);
  console.log(`   - Has location virtual: ${hasLocationVirtual ? 'YES' : 'NO'}`);
  
  // Check if virtuals reference this.address
  const virtualReferencesAddress = propertySchemaContent.includes('this.address');
  console.log(`   - Virtuals reference this.address: ${virtualReferencesAddress ? 'YES' : 'NO'}`);
  
  // Check toJSON transform
  const hasToJSONTransform = propertySchemaContent.includes('toJSON:') && 
                           propertySchemaContent.includes('transform:');
  console.log(`   - Has toJSON transform: ${hasToJSONTransform ? 'YES' : 'NO'}`);
  
  // Check if transform aliases addressId to address
  const transformAliasesAddress = propertySchemaContent.includes('ret.address') ||
                                propertySchemaContent.includes('addressId') && 
                                propertySchemaContent.includes('address');
  console.log(`   - Transform handles address aliasing: ${transformAliasesAddress ? 'MAYBE' : 'NO'}`);
  
  console.log('\n❗ Issue Analysis:');
  
  if (hasAddressId && virtualReferencesAddress) {
    console.log('   ✅ CONFIRMED: Schema uses addressId reference but virtuals expect this.address');
    console.log('   📋 Solution needed:');
    console.log('      1. Update virtuals to use this.addressId (populated)');
    console.log('      2. Update toJSON transform to alias populated addressId as address');
    console.log('      3. Ensure all queries populate addressId');
  }
  
  // Extract and show the current virtual implementations
  console.log('\n📖 Current Virtual Implementations:');
  
  const fullAddressMatch = propertySchemaContent.match(/virtual\('fullAddress'\)\.get\(function\(\) \{[\s\S]*?\}\);/);
  if (fullAddressMatch) {
    console.log('   fullAddress virtual:');
    console.log('   ' + fullAddressMatch[0].replace(/\n/g, '\n   '));
  }
  
  const locationMatch = propertySchemaContent.match(/virtual\('location'\)\.get\(function\(\) \{[\s\S]*?\}\);/);
  if (locationMatch) {
    console.log('\n   location virtual:');
    console.log('   ' + locationMatch[0].replace(/\n/g, '\n   '));
  }
  
  // Extract and show current toJSON transform
  console.log('\n📖 Current toJSON Transform:');
  const toJSONMatch = propertySchemaContent.match(/toJSON: \{[\s\S]*?\}/);
  if (toJSONMatch) {
    console.log('   ' + toJSONMatch[0].replace(/\n/g, '\n   '));
  }
  
} catch (error) {
  console.error('❌ Analysis failed:', error.message);
}