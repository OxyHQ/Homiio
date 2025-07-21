/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

const Profile = require('../models').Profile;
const RoommateRequest = require('../models').RoommateRequest;
const RoommateRelationship = require('../models').RoommateRelationship;

// Remove fetchOxyUserData helper function

// Get all roommate profiles with enriched Oxy user data
const getRoommateProfiles = async (req, res) => {
  try {
    console.log('=== Roommate Profiles API Called ===');
    console.log('User ID:', req.user?.id || req.user?._id);
    console.log('Profile ID:', req.user?.profileId);
    console.log('Query params:', req.query);
    
    const { page = 1, limit = 20, minMatchPercentage, maxBudget, withPets, nonSmoking, interests, ageRange, gender, location } = req.query;
    
    // Build base query for profiles with roommate matching enabled
    const query = {
      'personalProfile.settings.roommate.enabled': true,
      _id: { $ne: req.user.profileId } // Exclude current user's profile
    };

    console.log('Base query:', JSON.stringify(query, null, 2));

    // Add basic filters that apply to profile data (not preferences)
    if (gender && gender !== 'any') {
      query['personalProfile.gender'] = gender;
    }

    if (location) {
      query['personalProfile.location'] = { $regex: location, $options: 'i' };
    }

    if (ageRange) {
      const { min, max } = JSON.parse(ageRange);
      const currentYear = new Date().getFullYear();
      query['personalProfile.dateOfBirth'] = {
        $gte: new Date(currentYear - max, 0, 1),
        $lte: new Date(currentYear - min, 11, 31)
      };
    }

    console.log('Final query:', JSON.stringify(query, null, 2));

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const profiles = await Profile.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 });

    console.log(`Found ${profiles.length} profiles with roommate matching enabled`);

    const total = await Profile.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    console.log(`Total profiles: ${total}, Total pages: ${totalPages}`);

    // Get current user's profile and preferences
    const currentProfile = await Profile.findById(req.user.profileId);
    const currentUserPrefs = currentProfile?.personalProfile?.settings?.roommate?.preferences;

    let profilesWithMatches = profiles;

    if (currentUserPrefs) {
      console.log('Current user has roommate preferences, calculating match percentages and applying filters');
      
      profilesWithMatches = profiles.map(profile => {
        const profilePrefs = profile.personalProfile?.settings?.roommate?.preferences;
        const matchPercentage = calculateMatchPercentage(currentUserPrefs, profilePrefs);
        
        return {
          ...profile.toObject(),
          matchPercentage
        };
      });

      // Apply preference-based filters
      if (maxBudget) {
        const budget = parseInt(maxBudget);
        profilesWithMatches = profilesWithMatches.filter(profile => {
          const profilePrefs = profile.personalProfile?.settings?.roommate?.preferences;
          if (!profilePrefs?.budget?.max) return true; // Include if no budget preference
          return profilePrefs.budget.max >= budget; // Profile owner's max budget should be >= current user's max budget
        });
        console.log(`After budget filter (maxBudget=${budget}): ${profilesWithMatches.length} profiles`);
      }

      if (withPets === 'true') {
        profilesWithMatches = profilesWithMatches.filter(profile => {
          const profilePrefs = profile.personalProfile?.settings?.roommate?.preferences;
          if (!profilePrefs?.lifestyle?.pets) return true; // Include if no pet preference
          return profilePrefs.lifestyle.pets === 'yes'; // Profile owner should want pets
        });
        console.log(`After pets filter (withPets=true): ${profilesWithMatches.length} profiles`);
      }

      if (nonSmoking === 'true') {
        profilesWithMatches = profilesWithMatches.filter(profile => {
          const profilePrefs = profile.personalProfile?.settings?.roommate?.preferences;
          if (!profilePrefs?.lifestyle?.smoking) return true; // Include if no smoking preference
          return profilePrefs.lifestyle.smoking === 'no'; // Profile owner should not want smoking
        });
        console.log(`After smoking filter (nonSmoking=true): ${profilesWithMatches.length} profiles`);
      }

      // Filter by minimum match percentage if specified
      if (minMatchPercentage) {
        profilesWithMatches = profilesWithMatches.filter(
          profile => profile.matchPercentage >= parseInt(minMatchPercentage)
        );
        console.log(`After minMatchPercentage filter: ${profilesWithMatches.length} profiles`);
      }

      // Sort by match percentage
      profilesWithMatches.sort((a, b) => b.matchPercentage - a.matchPercentage);
    } else {
      console.log('Current user does not have roommate preferences');
    }

    // No Oxy enrichment, just return profiles
    res.json({
      profiles: profilesWithMatches,
      total,
      page: parseInt(page),
      totalPages
    });
  } catch (error) {
    console.error('Error fetching roommate profiles:', error);
    res.status(500).json({ error: 'Failed to fetch roommate profiles' });
  }
};

// Get current user's roommate preferences
const getMyRoommatePreferences = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile?.personalProfile?.settings?.roommate?.preferences) {
      return res.json({ data: null });
    }

    res.json({ data: profile.personalProfile.settings.roommate.preferences });
  } catch (error) {
    console.error('Error fetching roommate preferences:', error);
    res.status(500).json({ error: 'Failed to fetch roommate preferences' });
  }
};

// Update roommate preferences
const updateRoommatePreferences = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { ageRange, gender, lifestyle, budget, moveInDate, leaseDuration, interests, location } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const updateData = {
      'personalProfile.settings.roommate.preferences': {
        ageRange,
        gender,
        lifestyle,
        budget,
        moveInDate,
        leaseDuration,
        interests,
        location
      }
    };

    const updatedProfile = await Profile.findByIdAndUpdate(
      profile._id,
      updateData,
      { new: true }
    );

    res.json({ data: updatedProfile.personalProfile.settings.roommate.preferences });
  } catch (error) {
    console.error('Error updating roommate preferences:', error);
    res.status(500).json({ error: 'Failed to update roommate preferences' });
  }
};

// Toggle roommate matching
const toggleRoommateMatching = async (req, res) => {
  try {
    const { enabled } = req.body;
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const updateData = {
      'personalProfile.settings.roommate.enabled': enabled
    };

    await Profile.findByIdAndUpdate(profile._id, updateData);

    res.json({ message: `Roommate matching ${enabled ? 'enabled' : 'disabled'} successfully` });
  } catch (error) {
    console.error('Error toggling roommate matching:', error);
    res.status(500).json({ error: 'Failed to toggle roommate matching' });
  }
};

// Get roommate requests
const getRoommateRequests = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get sent and received requests
    const sentRequests = await RoommateRequest.findSentRequests(profile._id);
    const receivedRequests = await RoommateRequest.findReceivedRequests(profile._id);

    res.json({
      data: {
        sent: sentRequests,
        received: receivedRequests
      }
    });
  } catch (error) {
    console.error('Error fetching roommate requests:', error);
    res.status(500).json({ error: 'Failed to fetch roommate requests' });
  }
};

// Send roommate request
const sendRoommateRequest = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { profileId } = req.params;
    const { message } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get sender's active profile
    const senderProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!senderProfile) {
      return res.status(404).json({ error: 'Sender profile not found' });
    }

    // Get receiver's profile
    const receiverProfile = await Profile.findById(profileId);
    
    if (!receiverProfile) {
      return res.status(404).json({ error: 'Receiver profile not found' });
    }

    // Check if receiver has roommate matching enabled
    if (!receiverProfile.personalProfile?.settings?.roommate?.enabled) {
      return res.status(400).json({ error: 'This user has roommate matching disabled' });
    }

    // Check if there's already an active request
    const existingRequest = await RoommateRequest.findActiveRequest(senderProfile._id, profileId);
    if (existingRequest) {
      return res.status(400).json({ error: 'A roommate request already exists between these users' });
    }

    // Calculate match percentage
    const senderPrefs = senderProfile.personalProfile?.settings?.roommate?.preferences;
    const receiverPrefs = receiverProfile.personalProfile?.settings?.roommate?.preferences;
    const matchPercentage = calculateMatchPercentage(senderPrefs, receiverPrefs);

    // Create roommate request
    const roommateRequest = await RoommateRequest.create({
      senderProfileId: senderProfile._id,
      receiverProfileId: profileId,
      message,
      matchPercentage
    });

    res.json({ 
      message: 'Roommate request sent successfully',
      data: roommateRequest
    });
  } catch (error) {
    console.error('Error sending roommate request:', error);
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

// Accept roommate request
const acceptRoommateRequest = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { requestId } = req.params;
    const { responseMessage } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get roommate request
    const roommateRequest = await RoommateRequest.findById(requestId);
    
    if (!roommateRequest) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    // Verify the user is the receiver
    if (roommateRequest.receiverProfileId.toString() !== profile._id.toString()) {
      return res.status(403).json({ error: 'You can only accept requests sent to you' });
    }

    // Accept the request
    await roommateRequest.accept(responseMessage);

    // Create roommate relationship
    const senderPrefs = roommateRequest.senderProfileId.personalProfile?.settings?.roommate?.preferences;
    const receiverPrefs = profile.personalProfile?.settings?.roommate?.preferences;
    
    // Calculate shared preferences
    const sharedPreferences = {
      budget: {
        min: Math.max(senderPrefs?.budget?.min || 0, receiverPrefs?.budget?.min || 0),
        max: Math.min(senderPrefs?.budget?.max || Infinity, receiverPrefs?.budget?.max || Infinity),
        currency: 'USD'
      },
      location: receiverPrefs?.location || senderPrefs?.location,
      moveInDate: receiverPrefs?.moveInDate || senderPrefs?.moveInDate,
      leaseDuration: receiverPrefs?.leaseDuration || senderPrefs?.leaseDuration,
      lifestyle: {
        smoking: receiverPrefs?.lifestyle?.smoking || senderPrefs?.lifestyle?.smoking,
        pets: receiverPrefs?.lifestyle?.pets || senderPrefs?.lifestyle?.pets,
        partying: receiverPrefs?.lifestyle?.partying || senderPrefs?.lifestyle?.partying,
        cleanliness: receiverPrefs?.lifestyle?.cleanliness || senderPrefs?.lifestyle?.cleanliness,
        schedule: receiverPrefs?.lifestyle?.schedule || senderPrefs?.lifestyle?.schedule
      }
    };

    const roommateRelationship = await RoommateRelationship.createRelationship(
      roommateRequest.senderProfileId._id,
      profile._id,
      roommateRequest.matchPercentage,
      sharedPreferences
    );

    // Update the request with the relationship ID
    roommateRequest.roommateRelationshipId = roommateRelationship._id;
    await roommateRequest.save();

    res.json({ 
      message: 'Roommate request accepted successfully',
      data: {
        request: roommateRequest,
        relationship: roommateRelationship
      }
    });
  } catch (error) {
    console.error('Error accepting roommate request:', error);
    res.status(500).json({ error: 'Failed to accept roommate request' });
  }
};

// Decline roommate request
const declineRoommateRequest = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { requestId } = req.params;
    const { responseMessage } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get roommate request
    const roommateRequest = await RoommateRequest.findById(requestId);
    
    if (!roommateRequest) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    // Verify the user is the receiver
    if (roommateRequest.receiverProfileId.toString() !== profile._id.toString()) {
      return res.status(403).json({ error: 'You can only decline requests sent to you' });
    }

    // Decline the request
    await roommateRequest.decline(responseMessage);

    res.json({ 
      message: 'Roommate request declined successfully',
      data: roommateRequest
    });
  } catch (error) {
    console.error('Error declining roommate request:', error);
    res.status(500).json({ error: 'Failed to decline roommate request' });
  }
};

// Helper function to calculate match percentage
const calculateMatchPercentage = (prefs1, prefs2) => {
  if (!prefs1 || !prefs2) return 0;

  let matchScore = 0;
  let totalFactors = 0;

  // Budget compatibility
  if (prefs1.budget && prefs2.budget) {
    const overlap = Math.min(prefs1.budget.max, prefs2.budget.max) - Math.max(prefs1.budget.min, prefs2.budget.min);
    if (overlap > 0) {
      matchScore += 20;
    }
    totalFactors += 20;
  }

  // Lifestyle compatibility
  if (prefs1.lifestyle && prefs2.lifestyle) {
    if (prefs1.lifestyle.smoking === prefs2.lifestyle.smoking) matchScore += 15;
    if (prefs1.lifestyle.pets === prefs2.lifestyle.pets) matchScore += 15;
    if (prefs1.lifestyle.cleanliness === prefs2.lifestyle.cleanliness) matchScore += 15;
    if (prefs1.lifestyle.schedule === prefs2.lifestyle.schedule) matchScore += 15;
    totalFactors += 60;
  }

  // Interests compatibility
  if (prefs1.interests && prefs2.interests) {
    const commonInterests = prefs1.interests.filter(interest => 
      prefs2.interests.includes(interest)
    );
    const interestScore = (commonInterests.length / Math.max(prefs1.interests.length, prefs2.interests.length)) * 20;
    matchScore += interestScore;
    totalFactors += 20;
  }

  return totalFactors > 0 ? Math.round((matchScore / totalFactors) * 100) : 0;
};

// Get current user's roommate status with Oxy user data
const getCurrentUserRoommateStatus = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    const hasRoommateMatching = profile?.personalProfile?.settings?.roommate?.enabled || false;
    
    // Get active roommate relationships
    const relationships = profile ? await RoommateRelationship.findByProfile(profile._id) : [];
    
    // Get pending requests count
    const pendingRequests = profile ? await RoommateRequest.findPendingRequests(profile._id) : [];
    
    res.json({
      hasRoommateMatching,
      profile: profile ? {
        id: profile._id,
        roommatePreferences: profile.personalProfile?.settings?.roommate?.preferences || null
      } : null,
      relationships: relationships.length,
      pendingRequests: pendingRequests.length
    });
  } catch (error) {
    console.error('Error fetching current user roommate status:', error);
    res.status(500).json({ error: 'Failed to fetch roommate status' });
  }
};

// Get current user's roommate relationships
const getMyRoommateRelationships = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get active roommate relationships
    const relationships = await RoommateRelationship.findByProfile(profile._id);

    res.json({
      data: relationships
    });
  } catch (error) {
    console.error('Error fetching roommate relationships:', error);
    res.status(500).json({ error: 'Failed to fetch roommate relationships' });
  }
};

// End a roommate relationship
const endRoommateRelationship = async (req, res) => {
  try {
    const oxyUserId = req.user?.id || req.user?._id;
    const { relationshipId } = req.params;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Get roommate relationship
    const relationship = await RoommateRelationship.findById(relationshipId);
    
    if (!relationship) {
      return res.status(404).json({ error: 'Roommate relationship not found' });
    }

    // Verify the user is part of this relationship
    if (relationship.profile1Id.toString() !== profile._id.toString() && 
        relationship.profile2Id.toString() !== profile._id.toString()) {
      return res.status(403).json({ error: 'You can only end relationships you are part of' });
    }

    // End the relationship
    await relationship.endRelationship();

    res.json({ 
      message: 'Roommate relationship ended successfully',
      data: relationship
    });
  } catch (error) {
    console.error('Error ending roommate relationship:', error);
    res.status(500).json({ error: 'Failed to end roommate relationship' });
  }
};

module.exports = {
  getRoommateProfiles,
  getMyRoommatePreferences,
  updateRoommatePreferences,
  toggleRoommateMatching,
  getRoommateRequests,
  sendRoommateRequest,
  acceptRoommateRequest,
  declineRoommateRequest,
  getCurrentUserRoommateStatus,
  getMyRoommateRelationships,
  endRoommateRelationship
}; 