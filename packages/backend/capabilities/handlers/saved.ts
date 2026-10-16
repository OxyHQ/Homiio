/**
 * Saved-home, folder, saved-search, alert and recently-viewed tools →
 * `domain/saved.ts`, as the effective account.
 *
 * Outputs are the routes' bodies minus their envelope (`{ data }`). The alert
 * list also carries the paging the route puts in `meta` (`total`, `limit`,
 * `offset`, `hasMore`), because without it a caller cannot page.
 */

import {
  clearRecentlyViewedHomes,
  createSavedFolder,
  createSavedSearch,
  deleteSavedFolder,
  deleteSavedSearch,
  getHousingAlert,
  listHousingAlerts,
  listRecentlyViewedHomes,
  listSavedFolders,
  listSavedHomes,
  listSavedSearches,
  saveHome,
  setSavedSearchNotifications,
  unsaveHome,
  updateSavedFolder,
  updateSavedHomeNotes,
  updateSavedSearch,
} from '../../domain/saved';
import {
  type HomiioToolHandlers,
  optionalInteger,
  requiredString,
  type ToolInput,
} from './context';

/** The input minus the named keys, as the route's body would carry it. */
function bodyWithout(input: ToolInput, ...keys: string[]): Record<string, unknown> {
  const body: Record<string, unknown> = { ...input };
  for (const key of keys) delete body[key];
  return body;
}

export const SAVED_HANDLERS: HomiioToolHandlers = {
  async listSavedHomes(_input, { accountId }) {
    return { data: await listSavedHomes(accountId) };
  },

  async saveHome(input, { accountId }) {
    return {
      data: await saveHome(accountId, {
        propertyId: input.propertyId,
        notes: input.notes,
        folderId: input.folderId,
      }),
    };
  },

  async unsaveHome(input, { accountId }) {
    await unsaveHome(accountId, requiredString(input, 'propertyId'));
    return { data: null };
  },

  async updateSavedHomeNotes(input, { accountId }) {
    return {
      data: await updateSavedHomeNotes(accountId, requiredString(input, 'propertyId'), input.notes),
    };
  },

  async listSavedFolders(_input, { accountId }) {
    return { data: await listSavedFolders(accountId) };
  },

  async createSavedFolder(input, { accountId }) {
    return { data: await createSavedFolder(accountId, input) };
  },

  async updateSavedFolder(input, { accountId }) {
    return {
      data: await updateSavedFolder(
        accountId,
        requiredString(input, 'folderId'),
        bodyWithout(input, 'folderId'),
      ),
    };
  },

  async deleteSavedFolder(input, { accountId }) {
    await deleteSavedFolder(accountId, requiredString(input, 'folderId'));
    return { data: null };
  },

  async listSavedSearches(_input, { accountId }) {
    return { data: await listSavedSearches(accountId) };
  },

  async createSavedSearch(input, { accountId }) {
    return { data: await createSavedSearch(accountId, { ...input }) };
  },

  async updateSavedSearch(input, { accountId }) {
    return {
      data: await updateSavedSearch(
        accountId,
        requiredString(input, 'searchId'),
        bodyWithout(input, 'searchId'),
      ),
    };
  },

  async deleteSavedSearch(input, { accountId }) {
    await deleteSavedSearch(accountId, requiredString(input, 'searchId'));
    return { data: null };
  },

  async setSavedSearchAlerts(input, { accountId }) {
    return {
      data: await setSavedSearchNotifications(
        accountId,
        requiredString(input, 'searchId'),
        input.notificationsEnabled,
      ),
    };
  },

  async listHousingAlerts(input, { accountId }) {
    const { alerts, ...paging } = await listHousingAlerts(accountId, {
      limit: input.limit,
      offset: input.offset,
      watchId: input.watchId,
    });
    return { data: alerts, ...paging };
  },

  async getHousingAlert(input, { accountId }) {
    return { data: await getHousingAlert(accountId, requiredString(input, 'alertId')) };
  },

  async listRecentlyViewedHomes(input, { accountId }) {
    return { data: await listRecentlyViewedHomes(accountId, optionalInteger(input, 'limit')) };
  },

  async clearRecentlyViewedHomes(_input, { accountId }) {
    return { data: await clearRecentlyViewedHomes(accountId) };
  },
};
