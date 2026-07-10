// Thin compatibility wrapper around refactored modular handlers.
import * as profileHandlers from './profile';

class ProfileController { }

// Attach handlers to preserve existing interface (instance methods)
const handlerNames: Array<keyof typeof profileHandlers> = [
  'test',
  'getOrCreateActiveProfile',
  'getUserProfiles',
  'updateProfile',
  'getProfileById',
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
