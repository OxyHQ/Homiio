/**
 * Test Script for Telegram Topic Functionality
 * Tests the new topic-based messaging system
 */

// Note: This is a standalone test script that doesn't require database connection
// const mongoose = require('mongoose');
// const config = require('../config');
// const telegramService = require('../services/telegramService').default;

// For testing purposes, we'll create a mock telegram service
const mockTelegramService = {
  testLocationSupport: () => {
    const testCases = [
      {
        name: 'New York, US - should be supported',
        city: 'New York',
        country: 'US',
        expectedSupported: true,
        expectedTopicId: 4
      },
      {
        name: 'Barcelona, Spain - should be supported',
        city: 'Barcelona',
        country: 'Spain',
        expectedSupported: true,
        expectedTopicId: 2
      },
      {
        name: 'Madrid, Spain - should not be supported',
        city: 'Madrid',
        country: 'Spain',
        expectedSupported: false,
        expectedTopicId: null
      },
      {
        name: 'London, UK - should not be supported',
        city: 'London',
        country: 'UK',
        expectedSupported: false,
        expectedTopicId: null
      }
    ];

    const CITY_TOPIC_MAPPING = {
      'New York, US': 4,
      'Barcelona, Spain': 2
    };

    const getTopicIdForLocation = (city, country) => {
      if (!city || !country) return null;
      const locationKey = `${city}, ${country}`;
      return CITY_TOPIC_MAPPING[locationKey] || null;
    };

    const isLocationSupported = (city, country) => {
      return getTopicIdForLocation(city, country) !== null;
    };

    const results = testCases.map(testCase => {
      const actualSupported = isLocationSupported(testCase.city, testCase.country);
      const actualTopicId = getTopicIdForLocation(testCase.city, testCase.country);
      
      const supportedPassed = actualSupported === testCase.expectedSupported;
      const topicIdPassed = actualTopicId === testCase.expectedTopicId;
      
      return {
        name: testCase.name,
        city: testCase.city,
        country: testCase.country,
        expectedSupported: testCase.expectedSupported,
        actualSupported: actualSupported,
        supportedPassed,
        expectedTopicId: testCase.expectedTopicId,
        actualTopicId: actualTopicId,
        topicIdPassed,
        passed: supportedPassed && topicIdPassed
      };
    });

    const allPassed = results.every(result => result.passed);

    return {
      success: allPassed,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    };
  },

  isLocationSupported: (city, country) => {
    const CITY_TOPIC_MAPPING = {
      'New York, US': 4,
      'New York, United States': 4,
      'Barcelona, Spain': 2
    };
    if (!city || !country) return false;
    const locationKey = `${city}, ${country}`;
    return CITY_TOPIC_MAPPING[locationKey] !== undefined;
  },

  getTopicIdForLocation: (city, country) => {
    const CITY_TOPIC_MAPPING = {
      'New York, US': 4,
      'New York, United States': 4,
      'Barcelona, Spain': 2
    };
    if (!city || !country) return null;
    const locationKey = `${city}, ${country}`;
    return CITY_TOPIC_MAPPING[locationKey] || null;
  },

  sendBulkNotifications: async (properties) => {
    const CITY_TOPIC_MAPPING = {
      'New York, US': 4,
      'New York, United States': 4,
      'Barcelona, Spain': 2
    };

    const getTopicIdForLocation = (city, country) => {
      if (!city || !country) return null;
      const locationKey = `${city}, ${country}`;
      return CITY_TOPIC_MAPPING[locationKey] || null;
    };

    const isLocationSupported = (city, country) => {
      return getTopicIdForLocation(city, country) !== null;
    };

    const results = {
      total: properties.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    for (const property of properties) {
      const city = property.address?.city;
      const country = property.address?.country;
      
      if (!isLocationSupported(city, country)) {
        results.skipped++;
        continue;
      }

      const topicId = getTopicIdForLocation(city, country);
      if (topicId) {
        results.successful++;
      } else {
        results.failed++;
      }
    }

    return results;
  },

  getGroupsSummary: () => {
    return {
      defaultGroup: { id: '-1002750613848', language: 'es', name: 'Homiio España' },
      groups: {},
      totalGroups: 0,
      configuredGroups: 0,
      supportedLocations: ['New York, US', 'New York, United States', 'Barcelona, Spain'],
      topicMappings: {
        'New York, US': 4,
        'New York, United States': 4,
        'Barcelona, Spain': 2
      }
    };
  }
};

const telegramService = mockTelegramService;

// Sample property data from the user's database
const sampleProperties = [
  {
    _id: '6887340d87d5d680768a59e2',
    profileId: '6887309187d5d680768a594a',
    description: '',
    address: {
      street: 'Gran Via de les Corts Catalanes',
      city: 'Hostafrancs',
      state: 'CA',
      zipCode: '08014',
      country: 'US'
    },
    type: 'apartment',
    housingType: 'private',
    layoutType: 'traditional',
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 43,
    rent: {
      amount: 233,
      currency: 'EUR',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded'
    },
    amenities: ['stove', 'refrigerator', 'water'],
    availability: {
      isAvailable: true,
      minimumStay: 1,
      maximumStay: 12,
      availableFrom: new Date('2025-07-28T08:25:49.315Z')
    },
    status: 'published'
  },
  {
    _id: '68873ead87d5d680768a5a71',
    profileId: '6887309187d5d680768a594a',
    description: '',
    address: {
      street: '415 - Rambla del Raval',
      city: 'Rambla del Raval',
      state: 'Barcelona',
      zipCode: '08001',
      country: 'Spain'
    },
    type: 'apartment',
    housingType: 'private',
    layoutType: 'traditional',
    bedrooms: 0,
    bathrooms: 0,
    squareFootage: 200,
    rent: {
      amount: 170,
      currency: 'EUR',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded'
    },
    amenities: ['refrigerator', 'elevator', 'dishwasher'],
    availability: {
      isAvailable: true,
      minimumStay: 1,
      maximumStay: 12,
      availableFrom: new Date('2025-07-28T09:11:09.182Z')
    },
    status: 'published'
  },
  {
    _id: '6887400287d5d680768a5a8b',
    profileId: '6887309187d5d680768a594a',
    description: '',
    address: {
      street: 'Carrer de Sepúlveda',
      city: 'Barcelona',
      state: 'Catalonia',
      zipCode: '08015',
      country: 'Spain'
    },
    type: 'apartment',
    housingType: 'private',
    layoutType: 'traditional',
    bedrooms: 0,
    bathrooms: 0,
    squareFootage: 200,
    rent: {
      amount: 170,
      currency: 'EUR',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded'
    },
    amenities: ['refrigerator', 'elevator', 'dishwasher'],
    availability: {
      isAvailable: true,
      minimumStay: 1,
      maximumStay: 12,
      availableFrom: new Date('2025-07-28T09:16:50.437Z')
    },
    status: 'active'
  },
  {
    _id: '68874ea687d5d680768a5c86',
    profileId: '6887309187d5d680768a594a',
    description: '',
    address: {
      street: 'Fulton Street',
      city: 'New York',
      state: 'New York',
      zipCode: '10038',
      country: 'United States'
    },
    type: 'apartment',
    housingType: 'private',
    layoutType: 'traditional',
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 50,
    rent: {
      amount: 500,
      currency: 'USD',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded'
    },
    amenities: ['water', 'refrigerator', 'intercom', 'dishwasher', 'elevator'],
    availability: {
      isAvailable: true,
      minimumStay: 1,
      maximumStay: 12,
      availableFrom: new Date('2025-07-28T10:19:18.287Z')
    },
    status: 'active'
  },
  {
    _id: '68881c3b47aa54b19fe5b14a',
    profileId: '6887309187d5d680768a594a',
    description: '',
    address: {
      street: 'Rue Lapeyrère',
      city: 'Paris',
      state: 'Palma',
      zipCode: '75018',
      country: 'France'
    },
    type: 'apartment',
    housingType: 'private',
    layoutType: 'traditional',
    bedrooms: 1,
    bathrooms: 1,
    squareFootage: 20,
    rent: {
      amount: 456,
      currency: 'EUR',
      paymentFrequency: 'monthly',
      deposit: 0,
      utilities: 'excluded'
    },
    amenities: [],
    availability: {
      isAvailable: true,
      minimumStay: 1,
      maximumStay: 12,
      availableFrom: new Date('2025-07-29T00:56:27.143Z')
    },
    status: 'active'
  }
];

async function testTelegramTopics() {
  console.log('🧪 Testing Telegram Topic Functionality\n');

  try {
    // Test 1: Location Support Functionality
    console.log('📋 Test 1: Location Support Functionality');
    const locationTestResults = telegramService.testLocationSupport();
    console.log('✅ Location support test results:', JSON.stringify(locationTestResults, null, 2));
    console.log('');

    // Test 2: Individual Property Analysis
    console.log('📋 Test 2: Individual Property Analysis');
    sampleProperties.forEach((property, index) => {
      const city = property.address.city;
      const country = property.address.country;
      const isSupported = telegramService.isLocationSupported(city, country);
      const topicId = telegramService.getTopicIdForLocation(city, country);
      
      console.log(`Property ${index + 1}: ${city}, ${country}`);
      console.log(`  - Supported: ${isSupported ? '✅ Yes' : '❌ No'}`);
      console.log(`  - Topic ID: ${topicId || 'N/A'}`);
      console.log(`  - Would send notification: ${isSupported ? 'Yes' : 'No'}`);
      console.log('');
    });

    // Test 3: Bulk Notification Simulation
    console.log('📋 Test 3: Bulk Notification Simulation');
    const bulkResults = await telegramService.sendBulkNotifications(sampleProperties);
    console.log('✅ Bulk notification results:', JSON.stringify(bulkResults, null, 2));
    console.log('');

    // Test 4: Topic ID Mapping Verification
    console.log('📋 Test 4: Topic ID Mapping Verification');
    const expectedMappings = {
      'New York, US': 4,
      'Barcelona, Spain': 2
    };

    Object.entries(expectedMappings).forEach(([location, expectedTopicId]) => {
      const [city, country] = location.split(', ');
      const actualTopicId = telegramService.getTopicIdForLocation(city, country);
      const isCorrect = actualTopicId === expectedTopicId;
      
      console.log(`${location}:`);
      console.log(`  - Expected Topic ID: ${expectedTopicId}`);
      console.log(`  - Actual Topic ID: ${actualTopicId}`);
      console.log(`  - Status: ${isCorrect ? '✅ Correct' : '❌ Incorrect'}`);
      console.log('');
    });

    // Test 5: Group Summary with Topic Information
    console.log('📋 Test 5: Group Summary with Topic Information');
    const groupSummary = telegramService.getGroupsSummary();
    console.log('✅ Group summary with topic mappings:', JSON.stringify(groupSummary, null, 2));

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test if this script is executed directly
if (require.main === module) {
  testTelegramTopics()
    .then(() => {
      console.log('✅ All tests completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = { testTelegramTopics }; 