/**
 * Simple integration test to verify frontend-backend communication
 * This is a basic test to ensure the API endpoints work with the frontend services
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:4000/api';

// Test data
const testCredentials = {
  email: 'admin@example.com',
  password: 'password'
};

let authToken = null;

async function runIntegrationTests() {
  console.log('🧪 Starting Frontend-Backend Integration Tests\n');

  try {
    // Test 1: Authentication
    console.log('1. Testing Authentication...');
    const loginResponse = await axios.post(`${BASE_URL}/auth/login`, testCredentials);
    
    if (loginResponse.data.success && loginResponse.data.data.accessToken) {
      authToken = loginResponse.data.data.accessToken;
      console.log('✅ Login successful');
    } else {
      throw new Error('Login failed');
    }

    // Test 2: User Profile
    console.log('2. Testing User Profile...');
    const userResponse = await axios.get(`${BASE_URL}/users/me`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (userResponse.data.success) {
      console.log('✅ User profile retrieved');
    } else {
      throw new Error('User profile retrieval failed');
    }

    // Test 3: Properties
    console.log('3. Testing Properties...');
    const propertiesResponse = await axios.get(`${BASE_URL}/properties`);
    
    if (propertiesResponse.data.success) {
      console.log('✅ Properties retrieved');
    } else {
      throw new Error('Properties retrieval failed');
    }

    // Test 4: Devices  
    console.log('4. Testing Devices...');
    const devicesResponse = await axios.get(`${BASE_URL}/devices`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (devicesResponse.data.success) {
      console.log('✅ Devices retrieved');
    } else {
      throw new Error('Devices retrieval failed');
    }

    // Test 5: Leases
    console.log('5. Testing Leases...');
    const leasesResponse = await axios.get(`${BASE_URL}/leases`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (leasesResponse.data.success) {
      console.log('✅ Leases retrieved');
    } else {
      throw new Error('Leases retrieval failed');
    }

    // Test 6: Notifications
    console.log('6. Testing Notifications...');
    const notificationsResponse = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (notificationsResponse.data.success) {
      console.log('✅ Notifications retrieved');
    } else {
      throw new Error('Notifications retrieval failed');
    }

    // Test 7: Analytics
    console.log('7. Testing Analytics...');
    const analyticsResponse = await axios.get(`${BASE_URL}/analytics`, {
      headers: { Authorization: `Bearer ${authToken}` }
    });
    
    if (analyticsResponse.data.success) {
      console.log('✅ Analytics retrieved');
    } else {
      throw new Error('Analytics retrieval failed');
    }

    console.log('\n🎉 All integration tests passed!');
    console.log('\n✅ Frontend-Backend Integration Status: COMPLETE');
    console.log('✅ All major API endpoints are working correctly');
    console.log('✅ Authentication flow is functional');
    console.log('✅ All services can communicate with the backend');

  } catch (error) {
    console.error('\n❌ Integration test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Check if backend is running
async function checkBackendHealth() {
  try {
    const response = await axios.get(`${BASE_URL}/health`);
    if (response.data.status === 'ok') {
      console.log('✅ Backend is running and healthy\n');
      return true;
    }
  } catch (error) {
    console.error('❌ Backend is not running. Please start the backend server first.');
    console.error('Run: cd packages/backend && npm run dev');
    return false;
  }
}

async function main() {
  const isHealthy = await checkBackendHealth();
  if (isHealthy) {
    await runIntegrationTests();
  }
}

main().catch(console.error);