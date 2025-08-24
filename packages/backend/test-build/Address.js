"use strict";
/**
 * Address Model
 * Modern ES module export for Address schema
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var mongoose_1 = require("mongoose");
var AddressSchema = new mongoose_1.Schema({
    street: {
        type: String,
        required: [true, 'Street address is required'],
        trim: true,
        maxlength: [200, 'Street address cannot exceed 200 characters']
    },
    city: {
        type: String,
        required: [true, 'City is required'],
        trim: true,
        maxlength: [100, 'City name cannot exceed 100 characters']
    },
    state: {
        type: String,
        required: [true, 'State is required'],
        trim: true,
        maxlength: [50, 'State name cannot exceed 50 characters']
    },
    zipCode: {
        type: String,
        required: [true, 'ZIP code is required'],
        trim: true,
        validate: {
            validator: function (v) {
                return /^\d{5}(-\d{4})?$/.test(v);
            },
            message: 'ZIP code must be in format 12345 or 12345-6789'
        }
    },
    country: {
        type: String,
        required: [true, 'Country is required'],
        trim: true,
        default: 'USA',
        maxlength: [50, 'Country name cannot exceed 50 characters']
    },
    neighborhood: {
        type: String,
        trim: true,
        maxlength: [100, 'Neighborhood name cannot exceed 100 characters']
    },
    coordinates: {
        type: {
            type: String,
            enum: ['Point'],
            required: true,
            default: 'Point'
        },
        coordinates: {
            type: [Number],
            required: true,
            validate: {
                validator: function (coords) {
                    if (!Array.isArray(coords) || coords.length !== 2) {
                        return false;
                    }
                    var lng = coords[0], lat = coords[1];
                    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
                },
                message: 'Coordinates must be an array [longitude, latitude] with valid ranges'
            }
        }
    }
}, {
    timestamps: true,
    toJSON: {
        virtuals: true,
        transform: function (doc, ret) {
            ret.id = ret._id;
            return ret;
        }
    },
    toObject: { virtuals: true }
});
// Indexes for better query performance
AddressSchema.index({ city: 1, state: 1 });
AddressSchema.index({ zipCode: 1 });
AddressSchema.index({ coordinates: '2dsphere' });
AddressSchema.index({ street: 1, city: 1, state: 1, zipCode: 1 }, { unique: true });
// Virtual for full address
AddressSchema.virtual('fullAddress').get(function () {
    return "".concat(this.street, ", ").concat(this.city, ", ").concat(this.state, " ").concat(this.zipCode);
});
// Virtual for location string
AddressSchema.virtual('location').get(function () {
    var parts = [];
    if (this.city)
        parts.push(this.city);
    if (this.state)
        parts.push(this.state);
    if (this.country && this.country !== 'USA')
        parts.push(this.country);
    return parts.join(', ');
});
// Static method to find or create address
AddressSchema.statics.findOrCreate = function (addressData) {
    return __awaiter(this, void 0, void 0, function () {
        var street, city, state, zipCode, _a, country, neighborhood, coordinates, address;
        return __generator(this, function (_b) {
            switch (_b.label) {
                case 0:
                    street = addressData.street, city = addressData.city, state = addressData.state, zipCode = addressData.zipCode, _a = addressData.country, country = _a === void 0 ? 'USA' : _a, neighborhood = addressData.neighborhood, coordinates = addressData.coordinates;
                    return [4 /*yield*/, this.findOne({
                            street: street.trim(),
                            city: city.trim(),
                            state: state.trim(),
                            zipCode: zipCode.trim(),
                            country: country.trim()
                        })];
                case 1:
                    address = _b.sent();
                    if (address) {
                        return [2 /*return*/, address];
                    }
                    // Create new address if not found
                    address = new this({
                        street: street.trim(),
                        city: city.trim(),
                        state: state.trim(),
                        zipCode: zipCode.trim(),
                        country: country.trim(),
                        neighborhood: neighborhood,
                        coordinates: coordinates
                    });
                    return [4 /*yield*/, address.save()];
                case 2: return [2 /*return*/, _b.sent()];
            }
        });
    });
};
// Instance methods
AddressSchema.methods.getCoordinates = function () {
    if (this.coordinates && this.coordinates.coordinates && this.coordinates.coordinates.length === 2) {
        return {
            longitude: this.coordinates.coordinates[0],
            latitude: this.coordinates.coordinates[1]
        };
    }
    return null;
};
AddressSchema.methods.setLocation = function (longitude, latitude) {
    this.coordinates = {
        type: 'Point',
        coordinates: [longitude, latitude]
    };
    return this;
};
exports.default = (0, mongoose_1.model)('Address', AddressSchema);
