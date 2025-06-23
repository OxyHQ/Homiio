/**
 * Roommate Controller
 * Handles roommate matching operations
 */

const User = require('../models/User');
const Profile = require('../models').Profile;

// Get all roommate profiles (profiles with roommate matching enabled)
const getRoommateProfiles = async (req, res) => {
  try {
    const { page = 1, limit = 20, minMatchPercentage, maxBudget, withPets, nonSmoking, interests, ageRange, gender, location } = req.query;
    
    // Build query for profiles with roommate matching enabled
    const query = {
      'personalProfile.settings.roommate.enabled': true,
      _id: { $ne: req.user.profileId } // Exclude current user's profile
    };

    // Add filters
    if (maxBudget) {
      query['personalProfile.settings.roommate.preferences.budget.max'] = { $lte: parseInt(maxBudget) };
    }

    if (withPets) {
      query['personalProfile.settings.roommate.preferences.lifestyle.pets'] = 'yes';
    }

    if (nonSmoking) {
      query['personalProfile.settings.roommate.preferences.lifestyle.smoking'] = 'no';
    }

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

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const profiles = await Profile.find(query)
      .skip(skip)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 });

    const total = await Profile.countDocuments(query);
    const totalPages = Math.ceil(total / parseInt(limit));

    // Calculate match percentages if current user has preferences
    const currentProfile = await Profile.findById(req.user.profileId);
    let profilesWithMatches = profiles;

    if (currentProfile?.personalProfile?.settings?.roommate?.preferences) {
      profilesWithMatches = profiles.map(profile => {
        const matchPercentage = calculateMatchPercentage(
          currentProfile.personalProfile.settings.roommate.preferences,
          profile.personalProfile?.settings?.roommate?.preferences
        );
        
        return {
          ...profile.toObject(),
          matchPercentage
        };
      });

      // Filter by minimum match percentage if specified
      if (minMatchPercentage) {
        profilesWithMatches = profilesWithMatches.filter(
          profile => profile.matchPercentage >= parseInt(minMatchPercentage)
        );
      }

      // Sort by match percentage
      profilesWithMatches.sort((a, b) => b.matchPercentage - a.matchPercentage);
    }

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

    const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
    
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

    const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
    
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

    // Find the user's primary profile
    const profile = await Profile.findPrimaryByOxyUserId(oxyUserId);
    
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

module.exports = {
  getRoommateProfiles,
  getMyRoommatePreferences,
  updateRoommatePreferences,
  toggleRoommateMatching,
  getRoommateRequests,
  sendRoommateRequest,
  acceptRoommateRequest,
  declineRoommateRequest
}; 