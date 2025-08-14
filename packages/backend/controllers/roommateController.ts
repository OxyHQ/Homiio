/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

const Profile = require('../models').Profile;
const { ProfileType } = require('@homiio/shared-types');
// Remove oxyServices and fetchOxyUserData related code
// const oxyServices = require('../services/oxyServices');

// Remove fetchOxyUserData helper function

// Get all roommate profiles with enriched Oxy user data
const getRoommateProfiles = async (req, res) => {
  try {
    console.log('=== Roommate Profiles API Called ===');
    console.log('User ID:', req.user?.id || req.user?._id);
    console.log('Profile ID:', req.user?.profileId);
    console.log('Query params:', req.query);
    
    const { page = 1, limit = 20, minMatchPercentage, maxBudget, withPets, nonSmoking, interests, ageRange, gender, location } = req.query;
    
    // Build base query for personal profiles with roommate matching enabled
    const query = {
      profileType: ProfileType.PERSONAL, // Only personal profiles can have roommate matching
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
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate preferences are only available for personal profiles' });
    }
    
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
    const { ageRange, gender, lifestyle, budget, moveInDate, leaseDuration, interests, location, enabled } = req.body;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get user's active profile
    const profile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate preferences are only available for personal profiles' });
    }

    const updateData: any = {
      'personalProfile.settings.roommate.preferences': {
        ageRange,
        gender,
        lifestyle,
        budget,
        moveInDate,
        leaseDuration,
        interests,
        location,
      },
    };
    if (typeof enabled === 'boolean') {
      updateData['personalProfile.settings.roommate.enabled'] = enabled;
    }

    const updatedProfile = await Profile.findByIdAndUpdate(
      profile._id,
      updateData,
      { new: true }
    );

    res.json({ data: updatedProfile.personalProfile.settings.roommate.preferences, enabled: updatedProfile.personalProfile.settings?.roommate?.enabled || false });
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

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate matching is only available for personal profiles' });
    }

    const updateData = {
      'personalProfile.settings.roommate.enabled': enabled,
    };

    const updatedProfile = await Profile.findByIdAndUpdate(profile._id, updateData, { new: true });

    const updatedEnabled = Boolean(
      updatedProfile?.personalProfile?.settings?.roommate?.enabled,
    );

    res.json({
      message: `Roommate matching ${updatedEnabled ? 'enabled' : 'disabled'} successfully`,
      enabled: updatedEnabled,
    });
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

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate requests are only available for personal profiles' });
    }

    // This would typically involve a separate RoommateRequest model
    // For now, return empty arrays
    res.json({
      data: {
        sent: [],
        received: []
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
    const { profileId } = req.params;
    const { message } = req.body;
    const oxyUserId = req.user?.id || req.user?._id;

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // Get current user's profile
    const currentProfile = await Profile.findActiveByOxyUserId(oxyUserId);
    
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if current user has a personal profile
    if (currentProfile.profileType !== ProfileType.PERSONAL) {
      return res.status(403).json({ error: 'Roommate requests are only available for personal profiles' });
    }

    // Get target profile
    const targetProfile = await Profile.findById(profileId);
    
    if (!targetProfile) {
      return res.status(404).json({ error: 'Target profile not found' });
    }

    // Check if target profile is personal
    if (targetProfile.profileType !== ProfileType.PERSONAL) {
      return res.status(400).json({ error: 'Roommate requests can only be sent to personal profiles' });
    }

    // This would typically involve creating a RoommateRequest document
    // For now, just return success
    res.json({ message: 'Roommate request sent successfully' });
  } catch (error) {
    console.error('Error sending roommate request:', error);
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

// Accept roommate request
const acceptRoommateRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    // This would typically involve updating a RoommateRequest document
    // For now, just return success
    res.json({ message: 'Roommate request accepted successfully' });
  } catch (error) {
    console.error('Error accepting roommate request:', error);
    res.status(500).json({ error: 'Failed to accept roommate request' });
  }
};

// Decline roommate request
const declineRoommateRequest = async (req, res) => {
  try {
    const { requestId } = req.params;

    // This would typically involve updating a RoommateRequest document
    // For now, just return success
    res.json({ message: 'Roommate request declined successfully' });
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
    
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // Check if profile is personal type
    if (profile.profileType !== ProfileType.PERSONAL) {
      return res.json({
        hasRoommateMatching: false,
        profile: null,
        error: 'Roommate matching is only available for personal profiles'
      });
    }

    const hasRoommateMatching = profile?.personalProfile?.settings?.roommate?.enabled || false;
    
    // Remove Oxy user data fetching and just return profile info
    res.json({
      hasRoommateMatching,
      profile: profile ? {
        id: profile._id,
        profileType: profile.profileType,
        roommatePreferences: profile.personalProfile?.settings?.roommate?.preferences || null
      } : null
    });
  } catch (error) {
    console.error('Error fetching current user roommate status:', error);
    res.status(500).json({ error: 'Failed to fetch roommate status' });
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
  getCurrentUserRoommateStatus
}; 