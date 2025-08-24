/**
 * Quick test to verify coordinate transformation is working
 */

const { Property } = require('./models/index');
const { transformAddressFields } = require('./utils/helpers');

async function testCoordinateTransformation() {
  console.log('Testing coordinate transformation...');
  
  try {
    // Test with a sample property (you can replace with a real property ID)
    const property = await Property.findOne().populate('addressId').lean();
    
    if (!property) {
      console.log('No property found to test with');
      return;
    }
    
    console.log('Before transformation:', {
      hasAddressId: !!property.addressId,
      hasAddress: !!property.address,
      addressIdType: typeof property.addressId,
      coordinates: property.addressId?.coordinates
    });
    
    // Apply transformation
    transformAddressFields(property);
    
    console.log('After transformation:', {
      hasAddressId: !!property.addressId,
      hasAddress: !!property.address,
      addressType: typeof property.address,
      coordinates: property.address?.coordinates
    });
    
    // Check if coordinates are properly accessible
    const coordinates = property?.address?.coordinates?.type === 'Point'
      ? property.address.coordinates.coordinates
      : undefined;
      
    console.log('Extracted coordinates for map:', coordinates);
    
    if (Array.isArray(coordinates) && coordinates.length === 2) {
      console.log('✅ Coordinates are properly accessible:', coordinates);
    } else {
      console.log('❌ Coordinates are not properly accessible');
    }
    
  } catch (error) {
    console.error('Test failed:', error);
  }
}

testCoordinateTransformation();
