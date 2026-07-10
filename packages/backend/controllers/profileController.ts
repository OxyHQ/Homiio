import * as profileHandlers from './profile';

class ProfileController { }

const handlerNames: Array<keyof typeof profileHandlers> = [
  'test',
  'getOrCreateProfile',
  'getPublicProfileByOxyUserId',
  'getProfileByOxyUserId',
  'updateMyProfile',
  'getSavedProperties',
  'saveProperty',
  'unsaveProperty',
  'updateSavedPropertyNotes',
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
