/**
 * Roommate Controller
 * Handles roommate matching operations with Oxy user data integration
 */

const Profile = require('../models').Profile;
const oxyServices = require('../services/oxyServices');

// Helper function to fetch Oxy user data
const fetchOxyUserData = async (oxyUserId) => {
  if (!oxyUserId) {
    console.warn('[OXY] Missing oxyUserId, cannot fetch user data');
    return null;
  }
  
  if (!oxyServices || !oxyServices.users) {
    console.error('[OXY] Oxy services not properly initialized, cannot fetch user data');
    console.error('[OXY] oxyServices:', oxyServices);
    console.error('[OXY] oxyServices.users:', oxyServices?.users);
    return null;
  }
  
  try {
    console.log('[OXY] Fetching user data for oxyUserId:', oxyUserId);
    console.log('[OXY] Using OxyServices baseURL:', oxyServices.baseURL);
    console.log('[OXY] Available methods on oxyServices.users:', Object.keys(oxyServices.users));
    
    const userData = await oxyServices.users.getUser(oxyUserId);
    console.log('[OXY] Received user data:', userData);
    
    if (!userData) {
      console.warn('[OXY] No user data returned for oxyUserId:', oxyUserId);
      return null;
    }
    
    const enrichedData = {
      fullName: userData.name || userData.fullName || 'User',
      bio: userData.bio || '',
      avatar: userData.avatar || null,
      username: userData.username || '',
      email: userData.email || '',
      location: userData.location || '',
      website: userData.website || '',
      createdAt: userData.createdAt || null,
      stats: userData.stats || {}
    };
    
    console.log('[OXY] Enriched user data:', enrichedData);
    return enrichedData;
  } catch (error) {
    console.error('[OXY] Error fetching Oxy user data for', oxyUserId, ':', error.message);
    console.error('[OXY] Full error:', error);
    return null;
  }
};

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

    // Enrich profiles with Oxy user data
    console.log('Enriching profiles with Oxy user data...');
    const enrichedProfiles = await Promise.all(
      profilesWithMatches.map(async (profile) => {
        const oxyUserId = profile.oxyUserId;
        console.log('[ROOMMATE] Profile _id:', profile._id, 'oxyUserId:', oxyUserId);
        if (!oxyUserId) {
          console.warn('[ENRICH] Skipping profile with missing oxyUserId:', profile._id);
          return null;
        }
        try {
          const oxyUserData = await fetchOxyUserData(oxyUserId);
          console.log('[ROOMMATE] Oxy user data for', oxyUserId, ':', oxyUserData);
          return {
            ...profile,
            userData: oxyUserData || {
              fullName: 'User',
              bio: '',
              avatar: null,
              username: '',
              email: '',
              location: '',
              website: '',
              createdAt: null,
              stats: {}
            }
          };
        } catch (error) {
          console.error(`[ENRICH] Error enriching profile ${profile._id}:`, error);
          return {
            ...profile,
            userData: {
              fullName: 'User',
              bio: '',
              avatar: null,
              username: '',
              email: '',
              location: '',
              website: '',
              createdAt: null,
              stats: {}
            }
          };
        }
      })
    );

    const filteredEnrichedProfiles = enrichedProfiles.filter(Boolean);

    console.log(`Returning ${filteredEnrichedProfiles.length} enriched profiles`);
    console.log('=== End Roommate Profiles API ===');

    res.json({
      profiles: filteredEnrichedProfiles,
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
    const hasRoommateMatching = profile?.personalProfile?.settings?.roommate?.enabled || false;
    
    // Fetch additional user data from Oxy
    const userData = await fetchOxyUserData(oxyUserId);
    
    res.json({
      hasRoommateMatching,
      userData: userData || {
        fullName: 'User',
        bio: '',
        avatar: null,
        username: '',
        email: '',
        location: '',
        website: '',
        createdAt: null,
        stats: {}
      },
      profile: profile ? {
        id: profile._id,
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