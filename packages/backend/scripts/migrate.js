/**
 * Database Migration Script
 * Sets up initial data and indexes for the Homiio database
 */

const database = require('../database/connection');
const { PropertyModel, UserModel, RoomModel } = require('../models');

async function runMigrations() {
  try {
    console.log('🔄 Starting database migrations...');
    
    // Connect to database
    await database.connect();
    
    // Create indexes (they're already defined in schemas, but this ensures they exist)
    console.log('📝 Creating database indexes...');
    await PropertyModel.createIndexes();
    await UserModel.createIndexes();
    await RoomModel.createIndexes();
    
    // Check if we already have data
    const propertyCount = await PropertyModel.countDocuments();
    
    if (propertyCount === 0) {
      console.log('📊 Creating sample data...');
      await createSampleData();
    } else {
      console.log(`📊 Database already has ${propertyCount} properties. Skipping sample data creation.`);
    }
    
    console.log('✅ Database migrations completed successfully');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
}

async function createSampleData() {
  try {
    // Create sample properties
    const sampleProperties = [
      {
        ownerId: 'sample_user_1',
        title: 'Modern Downtown Apartment',
        description: 'Beautiful 2-bedroom apartment with city views and modern amenities',
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          zipCode: '94102',
          country: 'USA',
          coordinates: {
            lat: 37.7749,
            lng: -122.4194
          }
        },
        type: 'apartment',
        bedrooms: 2,
        bathrooms: 2,
        squareFootage: 1200,
        rent: {
          amount: 3500,
          currency: 'USD',
          paymentFrequency: 'monthly',
          deposit: 7000,
          utilities: 'included'
        },
        amenities: ['gym', 'pool', 'parking', 'laundry', 'eco-friendly'],
        rules: {
          pets: true,
          smoking: false,
          parties: false,
          guests: true,
          maxOccupancy: 2
        },
        availability: {
          isAvailable: true,
          availableFrom: new Date(),
          minimumStay: 6,
          maximumStay: 24
        },
        energyMonitoring: {
          enabled: true,
          sensors: ['energy_meter_1', 'temperature_1']
        },
        status: 'active'
      },
      {
        ownerId: 'sample_user_2',
        title: 'Cozy Suburban House',
        description: 'Spacious family home with garden and garage',
        address: {
          street: '456 Oak Ave',
          city: 'Austin',
          state: 'TX',
          zipCode: '73301',
          country: 'USA',
          coordinates: {
            lat: 30.2672,
            lng: -97.7431
          }
        },
        type: 'house',
        bedrooms: 3,
        bathrooms: 2.5,
        squareFootage: 1800,
        rent: {
          amount: 2200,
          currency: 'USD',
          paymentFrequency: 'monthly',
          deposit: 4400,
          utilities: 'excluded'
        },
        amenities: ['garden', 'garage', 'dishwasher', 'solar'],
        rules: {
          pets: true,
          smoking: false,
          parties: true,
          guests: true,
          maxOccupancy: 4
        },
        availability: {
          isAvailable: true,
          availableFrom: new Date(),
          minimumStay: 12,
          maximumStay: 24
        },
        energyMonitoring: {
          enabled: true,
          sensors: ['energy_meter_2', 'solar_panel_1']
        },
        status: 'active'
      },
      {
        ownerId: 'sample_user_3',
        title: 'Eco-friendly Studio Loft',
        description: 'Modern studio with sustainable features and great natural light',
        address: {
          street: '789 Green St',
          city: 'Portland',
          state: 'OR',
          zipCode: '97201',
          country: 'USA',
          coordinates: {
            lat: 45.5152,
            lng: -122.6784
          }
        },
        type: 'studio',
        bedrooms: 0,
        bathrooms: 1,
        squareFootage: 600,
        rent: {
          amount: 1200,
          currency: 'USD',
          paymentFrequency: 'monthly',
          deposit: 2400,
          utilities: 'included'
        },
        amenities: ['eco-friendly', 'green', 'solar', 'bike-storage'],
        rules: {
          pets: false,
          smoking: false,
          parties: false,
          guests: true,
          maxOccupancy: 1
        },
        availability: {
          isAvailable: true,
          availableFrom: new Date(),
          minimumStay: 3,
          maximumStay: 12
        },
        energyMonitoring: {
          enabled: true,
          sensors: ['energy_meter_3', 'air_quality_1']
        },
        status: 'active'
      }
    ];

    const createdProperties = await PropertyModel.insertMany(sampleProperties);
    console.log(`✅ Created ${createdProperties.length} sample properties`);

    // Create sample rooms for the first property
    const apartmentProperty = createdProperties[0];
    const sampleRooms = [
      {
        propertyId: apartmentProperty._id,
        name: 'Master Bedroom',
        description: 'Spacious master bedroom with ensuite bathroom',
        type: 'bedroom',
        floor: 1,
        squareFootage: 400,
        dimensions: {
          length: 20,
          width: 20,
          height: 9,
          unit: 'feet'
        },
        amenities: ['closet', 'ensuite', 'balcony'],
        features: [
          { name: 'Walk-in Closet', description: 'Large walk-in closet with built-in storage' },
          { name: 'Private Balcony', description: 'Private balcony with city views' }
        ],
        availability: {
          isAvailable: true,
          availableFrom: new Date()
        },
        occupancy: {
          maxOccupants: 2,
          currentOccupants: 0,
          occupantIds: []
        },
        sensors: [
          {
            type: 'temperature',
            sensorId: 'temp_sensor_1',
            location: 'Master Bedroom',
            isActive: true
          },
          {
            type: 'humidity',
            sensorId: 'humidity_sensor_1',
            location: 'Master Bedroom',
            isActive: true
          }
        ],
        status: 'available'
      },
      {
        propertyId: apartmentProperty._id,
        name: 'Second Bedroom',
        description: 'Comfortable second bedroom with great natural light',
        type: 'bedroom',
        floor: 1,
        squareFootage: 300,
        dimensions: {
          length: 15,
          width: 20,
          height: 9,
          unit: 'feet'
        },
        amenities: ['closet', 'window'],
        features: [
          { name: 'Built-in Closet', description: 'Built-in closet with shelving' },
          { name: 'Large Window', description: 'Large window with natural light' }
        ],
        availability: {
          isAvailable: true,
          availableFrom: new Date()
        },
        occupancy: {
          maxOccupants: 1,
          currentOccupants: 0,
          occupantIds: []
        },
        sensors: [
          {
            type: 'temperature',
            sensorId: 'temp_sensor_2',
            location: 'Second Bedroom',
            isActive: true
          }
        ],
        status: 'available'
      }
    ];

    const createdRooms = await RoomModel.insertMany(sampleRooms);
    console.log(`✅ Created ${createdRooms.length} sample rooms`);

    // Update the property with room references
    await PropertyModel.findByIdAndUpdate(
      apartmentProperty._id,
      { $push: { rooms: { $each: createdRooms.map(room => room._id) } } }
    );

    console.log('✅ Sample data creation completed');

  } catch (error) {
    console.error('❌ Error creating sample data:', error);
    throw error;
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations()
    .then(() => {
      console.log('🎉 All migrations completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

module.exports = {
  runMigrations,
  createSampleData
};
