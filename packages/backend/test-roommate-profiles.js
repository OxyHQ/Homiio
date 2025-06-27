const mongoose = require('mongoose');
const Profile = require('./models').Profile;

async function checkRoommateProfiles() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/homiio');
    console.log('Connected to MongoDB');

    // Check for profiles with roommate matching enabled
    const roommateProfiles = await Profile.find({
      'personalProfile.settings.roommate.enabled': true
    });

    console.log(`Found ${roommateProfiles.length} profiles with roommate matching enabled:`);
    
    roommateProfiles.forEach((profile, index) => {
      console.log(`\nProfile ${index + 1}:`);
      console.log(`- ID: ${profile._id}`);
      console.log(`- Name: ${profile.personalProfile?.firstName} ${profile.personalProfile?.lastName}`);
      console.log(`- Email: ${profile.personalProfile?.email}`);
      console.log(`- Roommate enabled: ${profile.personalProfile?.settings?.roommate?.enabled}`);
      console.log(`- Has preferences: ${!!profile.personalProfile?.settings?.roommate?.preferences}`);
      
      if (profile.personalProfile?.settings?.roommate?.preferences) {
        const prefs = profile.personalProfile.settings.roommate.preferences;
        console.log(`- Budget: $${prefs.budget?.min || 'N/A'} - $${prefs.budget?.max || 'N/A'}`);
        console.log(`- Age range: ${prefs.ageRange?.min || 'N/A'} - ${prefs.ageRange?.max || 'N/A'}`);
        console.log(`- Gender preference: ${prefs.gender || 'N/A'}`);
      }
    });

    // Check total profiles
    const totalProfiles = await Profile.countDocuments();
    console.log(`\nTotal profiles in database: ${totalProfiles}`);

    // Check profiles with roommate settings
    const profilesWithRoommateSettings = await Profile.countDocuments({
      'personalProfile.settings.roommate': { $exists: true }
    });
    console.log(`Profiles with roommate settings: ${profilesWithRoommateSettings}`);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

checkRoommateProfiles(); 