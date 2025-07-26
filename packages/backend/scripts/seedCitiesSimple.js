/**
 * Simple Cities Seeding Script
 * Directly connects to MongoDB and creates cities
 */

const mongoose = require('mongoose');

const citiesData = [
  {
    name: 'New York',
    state: 'New York',
    country: 'USA',
    coordinates: {
      lat: 40.7128,
      lng: -74.0060
    },
    timezone: 'America/New_York',
    population: 8336817,
    description: 'The Big Apple - a global center for finance, culture, and innovation with iconic landmarks and diverse neighborhoods.',
    popularNeighborhoods: ['Manhattan', 'Brooklyn', 'Queens', 'Bronx', 'Staten Island'],
    averageRent: 3500,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Los Angeles',
    state: 'California',
    country: 'USA',
    coordinates: {
      lat: 34.0522,
      lng: -118.2437
    },
    timezone: 'America/Los_Angeles',
    population: 3979576,
    description: 'The City of Angels - home to Hollywood, beautiful beaches, and year-round sunshine.',
    popularNeighborhoods: ['Hollywood', 'Venice Beach', 'Santa Monica', 'Downtown LA', 'West Hollywood'],
    averageRent: 2800,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Chicago',
    state: 'Illinois',
    country: 'USA',
    coordinates: {
      lat: 41.8781,
      lng: -87.6298
    },
    timezone: 'America/Chicago',
    population: 2693976,
    description: 'The Windy City - known for its architecture, deep-dish pizza, and vibrant arts scene.',
    popularNeighborhoods: ['Loop', 'River North', 'Lincoln Park', 'Wicker Park', 'Lakeview'],
    averageRent: 2200,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Miami',
    state: 'Florida',
    country: 'USA',
    coordinates: {
      lat: 25.7617,
      lng: -80.1918
    },
    timezone: 'America/New_York',
    population: 442241,
    description: 'The Magic City - tropical paradise with beautiful beaches, vibrant nightlife, and Latin American culture.',
    popularNeighborhoods: ['South Beach', 'Brickell', 'Wynwood', 'Coconut Grove', 'Coral Gables'],
    averageRent: 2500,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Austin',
    state: 'Texas',
    country: 'USA',
    coordinates: {
      lat: 30.2672,
      lng: -97.7431
    },
    timezone: 'America/Chicago',
    population: 978908,
    description: 'The Live Music Capital of the World - tech hub with a unique culture and outdoor lifestyle.',
    popularNeighborhoods: ['Downtown', 'East Austin', 'South Congress', 'Hyde Park', 'Zilker'],
    averageRent: 1800,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Seattle',
    state: 'Washington',
    country: 'USA',
    coordinates: {
      lat: 47.6062,
      lng: -122.3321
    },
    timezone: 'America/Los_Angeles',
    population: 744955,
    description: 'The Emerald City - surrounded by mountains and water, home to tech giants and coffee culture.',
    popularNeighborhoods: ['Capitol Hill', 'Belltown', 'Fremont', 'Ballard', 'Queen Anne'],
    averageRent: 2200,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Denver',
    state: 'Colorado',
    country: 'USA',
    coordinates: {
      lat: 39.7392,
      lng: -104.9903
    },
    timezone: 'America/Denver',
    population: 727211,
    description: 'The Mile High City - gateway to the Rocky Mountains with outdoor recreation and craft beer scene.',
    popularNeighborhoods: ['LoDo', 'RiNo', 'Highland', 'Wash Park', 'Cherry Creek'],
    averageRent: 2000,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Nashville',
    state: 'Tennessee',
    country: 'USA',
    coordinates: {
      lat: 36.1627,
      lng: -86.7816
    },
    timezone: 'America/Chicago',
    population: 689447,
    description: 'Music City - country music capital with southern charm and growing tech scene.',
    popularNeighborhoods: ['Downtown', 'East Nashville', '12 South', 'Germantown', 'The Gulch'],
    averageRent: 1600,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Portland',
    state: 'Oregon',
    country: 'USA',
    coordinates: {
      lat: 45.5152,
      lng: -122.6784
    },
    timezone: 'America/Los_Angeles',
    population: 654741,
    description: 'The City of Roses - known for sustainability, food trucks, and outdoor recreation.',
    popularNeighborhoods: ['Pearl District', 'Alberta Arts', 'Hawthorne', 'Mississippi', 'Division'],
    averageRent: 1800,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'San Francisco',
    state: 'California',
    country: 'USA',
    coordinates: {
      lat: 37.7749,
      lng: -122.4194
    },
    timezone: 'America/Los_Angeles',
    population: 873965,
    description: 'The Golden Gate City - tech innovation hub with iconic landmarks and diverse culture.',
    popularNeighborhoods: ['Mission', 'North Beach', 'Marina', 'Hayes Valley', 'Castro'],
    averageRent: 3800,
    currency: 'USD',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Barcelona',
    state: 'Catalonia',
    country: 'Spain',
    coordinates: {
      lat: 41.3851,
      lng: 2.1734
    },
    timezone: 'Europe/Madrid',
    population: 1620343,
    description: 'Cosmopolitan city with stunning architecture, vibrant culture, and Mediterranean lifestyle.',
    popularNeighborhoods: ['Eixample', 'Gràcia', 'Sant Martí', 'Sants-Montjuïc', 'Sarrià-Sant Gervasi'],
    averageRent: 1200,
    currency: 'EUR',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Berlin',
    state: 'Berlin',
    country: 'Germany',
    coordinates: {
      lat: 52.5200,
      lng: 13.4050
    },
    timezone: 'Europe/Berlin',
    population: 3669491,
    description: 'Creative capital with rich history, diverse neighborhoods, and vibrant arts scene.',
    popularNeighborhoods: ['Kreuzberg', 'Neukölln', 'Mitte', 'Friedrichshain', 'Prenzlauer Berg'],
    averageRent: 1100,
    currency: 'EUR',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Amsterdam',
    state: 'North Holland',
    country: 'Netherlands',
    coordinates: {
      lat: 52.3676,
      lng: 4.9041
    },
    timezone: 'Europe/Amsterdam',
    population: 821752,
    description: 'Charming canals and bike-friendly city with international appeal and progressive culture.',
    popularNeighborhoods: ['Jordaan', 'De Pijp', 'Oud-West', 'Centrum', 'Oost'],
    averageRent: 1400,
    currency: 'EUR',
    isActive: true,
    propertiesCount: 0
  },
  {
    name: 'Stockholm',
    state: 'Stockholm',
    country: 'Sweden',
    coordinates: {
      lat: 59.3293,
      lng: 18.0686
    },
    timezone: 'Europe/Stockholm',
    population: 975551,
    description: 'Scandinavian beauty with islands, modern sustainability, and high quality of life.',
    popularNeighborhoods: ['Södermalm', 'Östermalm', 'Vasastan', 'Kungsholmen', 'Norrmalm'],
    averageRent: 1300,
    currency: 'EUR',
    isActive: true,
    propertiesCount: 0
  }
];

async function seedCities() {
  try {
    console.log('🌱 Starting cities seeding...');
    
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/homio';
    console.log('🔗 Connecting to MongoDB...');
    console.log('📡 URI:', mongoUri.substring(0, 20) + '...');
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // Get the cities collection
    const db = mongoose.connection.db;
    const citiesCollection = db.collection('cities');

    // Clear existing cities
    await citiesCollection.deleteMany({});
    console.log('🗑️  Cleared existing cities');

    // Insert new cities
    const result = await citiesCollection.insertMany(citiesData);
    console.log(`✅ Seeded ${result.insertedCount} cities`);

    console.log('🎉 Cities seeding completed successfully!');
    
    // Display summary
    const totalCities = await citiesCollection.countDocuments();
    console.log(`📊 Total cities in database: ${totalCities}`);
    
    const popularCities = await citiesCollection.find().sort({ propertiesCount: -1 }).limit(5).toArray();
    console.log('🏆 Top cities by properties:');
    popularCities.forEach(city => {
      console.log(`  - ${city.name}, ${city.state}: ${city.propertiesCount} properties`);
    });

  } catch (error) {
    console.error('❌ Error seeding cities:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the seeding function
if (require.main === module) {
  seedCities();
}

module.exports = { seedCities, citiesData }; 