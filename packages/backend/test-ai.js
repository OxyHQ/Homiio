/**
 * Test script for AI endpoints
 * Run with: node test-ai.js
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:4000';

async function testAIEndpoints() {
  console.log('🧪 Testing AI Endpoints...\n');

  // Test 1: Health check
  console.log('1. Testing AI Health Check:');
  try {
    const healthResponse = await fetch(`${BASE_URL}/api/ai/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health Check Response:', JSON.stringify(healthData, null, 2));
  } catch (error) {
    console.log('❌ Health Check Failed:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 2: Chat endpoint (will fail without API key, but shows structure)
  console.log('2. Testing AI Chat Endpoint:');
  try {
    const chatResponse = await fetch(`${BASE_URL}/api/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: This would need a valid Oxy token in production
        // 'Authorization': 'Bearer YOUR_TOKEN'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, tell me about ethical housing in 2 sentences.'
          }
        ],
        maxTokens: 100
      })
    });

    const chatData = await chatResponse.json();
    console.log('✅ Chat Response:', JSON.stringify(chatData, null, 2));
  } catch (error) {
    console.log('❌ Chat Test Failed:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');

  // Test 3: Stream endpoint (will fail without API key, but shows structure)
  console.log('3. Testing AI Stream Endpoint:');
  try {
    const streamResponse = await fetch(`${BASE_URL}/api/ai/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Note: This would need a valid Oxy token in production
        // 'Authorization': 'Bearer YOUR_TOKEN'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: 'Hello, tell me about ethical housing in 2 sentences.'
          }
        ]
      })
    });

    if (streamResponse.ok) {
      console.log('✅ Stream Response Headers:', {
        'content-type': streamResponse.headers.get('content-type'),
        'content-encoding': streamResponse.headers.get('content-encoding')
      });
      
      // Note: In a real implementation, you would read the stream
      console.log('✅ Stream endpoint is working (would stream data with valid API key)');
    } else {
      const errorData = await streamResponse.json();
      console.log('❌ Stream Error:', JSON.stringify(errorData, null, 2));
    }
  } catch (error) {
    console.log('❌ Stream Test Failed:', error.message);
  }

  console.log('\n' + '='.repeat(50) + '\n');
  console.log('🎉 AI Endpoints Test Complete!');
  console.log('\nTo use these endpoints with real AI responses:');
  console.log('1. Set OPENAI_API_KEY environment variable');
  console.log('2. Include valid Oxy authentication token');
  console.log('3. Make requests to the endpoints');
}

// Run the tests
testAIEndpoints().catch(console.error); 