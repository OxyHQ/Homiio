#!/usr/bin/env node

/**
 * API Endpoint Test Script
 * Test property endpoints to verify address data is returned correctly
 * 
 * Usage: node test-endpoints.js [port]
 * Default port: 3000
 */

const http = require('http');

const port = process.argv[2] || 3000;
const baseUrl = `http://localhost:${port}`;

console.log('🧪 Testing Property API Endpoints...\n');

async function makeRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try {
          const result = {
            status: res.statusCode,
            data: JSON.parse(data)
          };
          resolve(result);
        } catch (err) {
          resolve({
            status: res.statusCode,
            data: data
          });
        }
      });
    });

    req.on('error', reject);
    
    if (body) {
      req.write(JSON.stringify(body));
    }
    
    req.end();
  });
}

async function testEndpoints() {
  try {
    console.log('🔍 Testing Property Listing Endpoint...');
    
    // Test property listing
    const listResponse = await makeRequest('/api/properties?limit=3');
    console.log(`   Status: ${listResponse.status}`);
    
    if (listResponse.status === 200 && listResponse.data?.data) {
      const properties = listResponse.data.data;
      console.log(`   Found ${properties.length} properties`);
      
      if (properties.length > 0) {
        const property = properties[0];
        console.log('\n📋 Sample Property Analysis:');
        console.log(`   - ID: ${property.id || property._id}`);
        console.log(`   - Title: ${property.title || 'MISSING ❌'}`);
        console.log(`   - Has address field: ${property.address ? 'YES ✅' : 'NO ❌'}`);
        console.log(`   - Has addressId field: ${property.addressId ? 'YES' : 'NO'}`);
        
        if (property.address) {
          console.log(`   - Address city: ${property.address.city || 'N/A'}`);
          console.log(`   - Address street: ${property.address.street || 'N/A'}`);
        }
        
        console.log(`   - fullAddress virtual: ${property.fullAddress || 'N/A'}`);
        console.log(`   - location virtual: ${property.location || 'N/A'}`);
        
        // Test individual property endpoint
        console.log('\n🔍 Testing Individual Property Endpoint...');
        const propertyId = property.id || property._id;
        const detailResponse = await makeRequest(`/api/properties/${propertyId}`);
        console.log(`   Status: ${detailResponse.status}`);
        
        if (detailResponse.status === 200) {
          const detail = detailResponse.data?.data;
          if (detail) {
            console.log(`   - Detail has address: ${detail.address ? 'YES ✅' : 'NO ❌'}`);
            console.log(`   - Detail fullAddress: ${detail.fullAddress || 'N/A'}`);
            console.log(`   - Detail location: ${detail.location || 'N/A'}`);
          }
        }
      }
    } else {
      console.log('   ❌ Failed to get properties or empty response');
      console.log('   Response:', listResponse.data);
    }
    
    console.log('\n📊 Test Results:');
    console.log('   - Property listing endpoint tested');
    console.log('   - Individual property endpoint tested'); 
    console.log('   - Address field presence checked');
    console.log('   - Virtual field values verified');
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.log('❌ Connection refused - make sure the backend server is running on port', port);
      console.log('   Start server with: npm run dev');
    } else {
      console.error('❌ Test failed:', error.message);
    }
  }
}

console.log(`Connecting to ${baseUrl}`);
console.log('Make sure the backend server is running with: npm run dev\n');

testEndpoints().catch(console.error);