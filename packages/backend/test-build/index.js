"use strict";
/**
 * Models Index
 * Central export for all Homiio Mongoose models
 * Supports both modern ES modules and legacy CommonJS for backward compatibility
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.Property = exports.Address = void 0;
// Modern ES module imports
var Address_1 = require("./Address");
exports.Address = Address_1.default;
var Property_1 = require("./Property");
exports.Property = Property_1.default;
// Legacy CommonJS imports for schemas not yet migrated
var RoomModel = require('./schemas/RoomSchema');
var LeaseModel = require('./schemas/LeaseSchema');
var RecentlyViewedModel = require('./schemas/RecentlyViewedSchema');
var ViewingRequestModel = require('./schemas/ViewingRequestSchema');
var SavedPropertyFolderModel = require('./schemas/SavedPropertyFolderSchema');
var SavedSearchModel = require('./schemas/SavedSearchSchema');
var ProfileModel = require('./schemas/ProfileSchema');
var ConversationModel = require('./schemas/ConversationSchema');
var CityModel = require('./schemas/CitySchema');
var SavedModel = require('./schemas/SavedSchema');
var BillingModel = require('./schemas/BillingSchema');
// Legacy CommonJS exports for backward compatibility
module.exports = {
    // Modern ES modules (preferred)
    Address: Address_1.default,
    Property: Property_1.default,
    // Legacy models (to be migrated)
    Room: RoomModel,
    Lease: LeaseModel,
    RecentlyViewed: RecentlyViewedModel,
    ViewingRequest: ViewingRequestModel,
    SavedPropertyFolder: SavedPropertyFolderModel,
    SavedSearch: SavedSearchModel,
    Profile: ProfileModel,
    Conversation: ConversationModel,
    City: CityModel,
    Saved: SavedModel,
    Billing: BillingModel
};
