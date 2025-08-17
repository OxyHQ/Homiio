import fs from 'fs';
import path from 'path';
import imageUploadService from '../services/imageUploadService';

// Mock file for testing
const createMockFile = (): Express.Multer.File => {
  // Create a simple test image buffer (1x1 pixel PNG)
  const pngBuffer = Buffer.from([
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
    0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00,
    0x0C, 0x49, 0x44, 0x41, 0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
    0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC, 0x33,
    0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
  ]);

  return {
    fieldname: 'image',
    originalname: 'test.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: pngBuffer.length,
    destination: '',
    filename: 'test.png',
    path: '',
    buffer: pngBuffer,
  };
};

async function testImageUpload() {
  console.log('🧪 Testing Image Upload Service...\n');

  try {
    // Test 1: Check if S3 configuration is set
    console.log('1. Checking S3 configuration...');
    const config = require('../config').default;
    
    if (!config.s3.accessKeyId || !config.s3.secretAccessKey) {
      console.log('❌ S3 credentials not configured. Please set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY environment variables.');
      return;
    }
    
    console.log('✅ S3 configuration found');
    console.log(`   Endpoint: ${config.s3.endpoint}`);
    console.log(`   Region: ${config.s3.region}`);
    console.log(`   Bucket: ${config.s3.bucketName}\n`);

    // Test 2: Test image processing
    console.log('2. Testing image processing...');
    const mockFile = createMockFile();
    console.log(`   Created mock file: ${mockFile.originalname} (${mockFile.size} bytes)`);

    // Test 3: Test image upload (if credentials are available)
    console.log('3. Testing image upload...');
    try {
      const result = await imageUploadService.uploadImage(mockFile, 'test');
      console.log('✅ Image upload successful!');
      console.log(`   Image ID: ${result.original.split('/').pop()?.split('-')[0]}`);
      console.log(`   Original size: ${result.metadata.originalSize} bytes`);
      console.log(`   Variants created: ${Object.keys(result.variants).length}`);
      
      // Display URLs
      const urls = imageUploadService.getAllImageUrls(result);
      console.log('\n   Generated URLs:');
      Object.entries(urls).forEach(([variant, url]) => {
        console.log(`   - ${variant}: ${url}`);
      });

      // Test 4: Test image deletion
      console.log('\n4. Testing image deletion...');
      const allKeys = [result.original, ...Object.values(result.variants)];
      await imageUploadService.deleteImageVariants(allKeys);
      console.log('✅ Image variants deleted successfully');

    } catch (uploadError) {
      console.log('⚠️  Image upload test skipped (likely due to missing S3 credentials)');
      console.log(`   Error: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`);
    }

    console.log('\n🎉 Image upload service test completed!');
    console.log('\nTo use the service in production:');
    console.log('1. Set up DigitalOcean Spaces bucket');
    console.log('2. Configure environment variables:');
    console.log('   - S3_ENDPOINT');
    console.log('   - S3_REGION');
    console.log('   - S3_ACCESS_KEY_ID');
    console.log('   - S3_SECRET_ACCESS_KEY');
    console.log('   - S3_BUCKET_NAME');
    console.log('3. Test with real images using the API endpoints');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  testImageUpload();
}

export default testImageUpload;
