// Thin compatibility wrapper around refactored modular handlers.
import * as profileHandlers from './profile';

class ProfileController { }

// Attach handlers to preserve existing interface (instance methods)
const handlerNames: Array<keyof typeof profileHandlers> = [
  'test',
  'getOrCreateActiveProfile',
  'getUserProfiles',
  'getProfileByType',
  'createProfile',
  'updateProfile',
  'deleteProfile',
  'activateProfile',
  'getProfileById',
  'getPublicProfileByOxyUserId',
  'updateActiveProfile',
  'getAgencyMemberships',
  'addAgencyMember',
  'removeAgencyMember',
  'updateActiveTrustScore',
  'updateTrustScore',
  'getTrustScore',
  'recalculateActiveTrustScore',
  'getSavedProperties',
  'saveProperty',
  'unsaveProperty',
  'updateSavedPropertyNotes',
  'getProfileProperties',
  'getSavedPropertyFolders',
  'createSavedPropertyFolder',
  'updateSavedPropertyFolder',
  'deleteSavedPropertyFolder',
  'getSavedSearches',
  'saveSearch',
  'deleteSavedSearch',
  'updateSavedSearch',
  'toggleSearchNotifications',
  'saveProfile',
  'unsaveProfile',
  'isProfileSaved',
  'getSavedProfiles',
  'getRecentProperties',
  'trackPropertyView',
  'clearRecentProperties',
  'debugRecentProperties',
];

const controller = new ProfileController() as ProfileController &
  Partial<Record<keyof typeof profileHandlers, unknown>>;

handlerNames.forEach((name) => {
  const handler = profileHandlers[name];
  if (typeof handler === 'function') {
    controller[name] = handler;
  }
});

module.exports = controller;
