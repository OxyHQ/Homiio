#!/usr/bin/env node

/**
 * Test Stripe Webhook Configuration
 * 
 * This script helps verify that your Stripe webhook is properly configured
 * and can receive events from Stripe.
 */

const https = require('https');
const http = require('http');

// Configuration
const config = {
  webhookUrl: process.env.STRIPE_WEBHOOK_URL || 'http://localhost:3000/api/billing/webhook',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret',
  testEvent: {
    id: 'evt_test_webhook',
    object: 'event',
    api_version: '2024-06-20',
    created: Math.floor(Date.now() / 1000),
    data: {
      object: {
        id: 'cs_test_webhook',
        object: 'checkout.session',
        amount_total: 1500,
        currency: 'usd',
        customer: null,
        metadata: {
          product: 'plus',
          profileId: '507f1f77bcf86cd799439011' // Test ObjectId
        },
        payment_status: 'paid',
        status: 'complete',
        subscription: 'sub_test_webhook'
      }
    },
    livemode: false,
    pending_webhooks: 1,
    request: {
      id: 'req_test_webhook',
      idempotency_key: null
    },
    type: 'checkout.session.completed'
  }
};

// Create webhook signature
function createWebhookSignature(payload, secret) {
  const crypto = require('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedPayload, 'utf8')
    .digest('hex');
  
  return `t=${timestamp},v1=${signature}`;
}

// Send test webhook
function sendTestWebhook() {
  const payload = JSON.stringify(config.testEvent);
  const signature = createWebhookSignature(payload, config.webhookSecret);
  
  const url = new URL(config.webhookUrl);
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload),
      'Stripe-Signature': signature,
      'User-Agent': 'Stripe/v1 WebhooksSimulator'
    }
  };

  const client = url.protocol === 'https:' ? https : http;
  
  console.log('🔔 Sending test webhook...');
  console.log('URL:', config.webhookUrl);
  console.log('Event Type:', config.testEvent.type);
  console.log('Signature:', signature.substring(0, 50) + '...');
  
  const req = client.request(options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      console.log('📡 Response Status:', res.statusCode);
      console.log('📡 Response Headers:', res.headers);
      console.log('📡 Response Body:', data);
      
      if (res.statusCode === 200) {
        console.log('✅ Webhook test successful!');
      } else {
        console.log('❌ Webhook test failed!');
      }
    });
  });

  req.on('error', (err) => {
    console.error('❌ Request error:', err.message);
  });

  req.write(payload);
  req.end();
}

// Check environment variables
function checkEnvironment() {
  console.log('🔍 Checking environment variables...');
  
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRICE_PLUS'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.log('❌ Missing environment variables:', missing);
    console.log('Please set these variables before running the test.');
    return false;
  }
  
  console.log('✅ All required environment variables are set');
  return true;
}

// Main execution
async function main() {
  console.log('🧪 Stripe Webhook Test Script');
  console.log('=============================\n');
  
  if (!checkEnvironment()) {
    process.exit(1);
  }
  
  console.log('\n📋 Test Configuration:');
  console.log('- Webhook URL:', config.webhookUrl);
  console.log('- Event Type:', config.testEvent.type);
  console.log('- Test Profile ID:', config.testEvent.data.object.metadata.profileId);
  
  console.log('\n🚀 Starting webhook test...\n');
  
  sendTestWebhook();
}

// Run if called directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { sendTestWebhook, checkEnvironment };
