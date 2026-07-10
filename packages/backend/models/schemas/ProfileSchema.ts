import type { IProfile } from '../documentTypes';

const mongoose = require('mongoose');
const {
  EmploymentStatus,
  LeaseDuration,
  PriceUnit,
  PropertyType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  GenderPreference,
} = require('@homiio/shared-types');

const DEFAULT_PERSONAL_PROFILE = {
  personalInfo: {
    bio: '',
    occupation: '',
    employer: '',
    annualIncome: null,
    employmentStatus: null,
    moveInDate: null,
    leaseDuration: null,
  },
  preferences: {},
  references: [],
  rentalHistory: [],
  verification: {},
  settings: {
    notifications: { email: true, push: true, sms: false },
    privacy: { profileVisibility: 'public', showContactInfo: true, showIncome: false },
    language: 'en',
    timezone: 'UTC',
  },
};

// Personal Profile Schema — app-specific RE/tenant data only
const personalProfileSchema = new mongoose.Schema({
  personalInfo: {
    bio: { type: String, maxlength: [500, 'Bio cannot exceed 500 characters'] },
    occupation: { type: String, trim: true },
    employer: { type: String, trim: true },
    annualIncome: { type: Number, min: [0, 'Annual income cannot be negative'] },
    employmentStatus: { type: String, enum: Object.values(EmploymentStatus) },
    moveInDate: { type: Date },
    leaseDuration: { type: String, enum: Object.values(LeaseDuration), default: LeaseDuration.YEARLY },
  },
  preferences: {
    propertyTypes: [{ type: String, enum: Object.values(PropertyType) }],
    maxRent: { type: Number, min: [0, 'Maximum rent cannot be negative'] },
    priceUnit: { type: String, enum: Object.values(PriceUnit), default: PriceUnit.MONTH },
    minBedrooms: { type: Number, min: [0], default: 0 },
    minBathrooms: { type: Number, min: [0], default: 0 },
    preferredAmenities: [{ type: String, trim: true, lowercase: true }],
    preferredLocations: [{
      city: String,
      state: String,
      radius: { type: Number, min: 1, max: 100, default: 10 },
    }],
    petFriendly: { type: Boolean, default: false },
    smokingAllowed: { type: Boolean, default: false },
    furnished: { type: Boolean, default: false },
    parkingRequired: { type: Boolean, default: false },
    accessibility: { type: Boolean, default: false },
  },
  references: [{
    name: { type: String, required: true, trim: true },
    relationship: { type: String, enum: Object.values(ReferenceRelationship), required: true },
    phone: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    verified: { type: Boolean, default: false },
  }],
  rentalHistory: [{
    address: { type: String, required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date },
    monthlyRent: { type: Number, min: 0 },
    reasonForLeaving: { type: String, enum: Object.values(ReasonForLeaving) },
    landlordContact: { name: String, phone: String, email: String },
    verified: { type: Boolean, default: false },
  }],
  verification: {
    identity: { type: Boolean, default: false },
    income: { type: Boolean, default: false },
    background: { type: Boolean, default: false },
    rentalHistory: { type: Boolean, default: false },
    references: { type: Boolean, default: false },
  },
  settings: {
    notifications: {
      email: { type: Boolean, default: true },
      push: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      propertyAlerts: { type: Boolean, default: true },
      viewingReminders: { type: Boolean, default: true },
      leaseUpdates: { type: Boolean, default: true },
    },
    privacy: {
      profileVisibility: { type: String, enum: Object.values(ProfileVisibility), default: ProfileVisibility.PUBLIC },
      showContactInfo: { type: Boolean, default: true },
      showIncome: { type: Boolean, default: false },
      showRentalHistory: { type: Boolean, default: false },
      showReferences: { type: Boolean, default: false },
    },
    roommate: {
      enabled: { type: Boolean, default: false },
      preferences: {
        ageRange: { min: { type: Number, min: 18, max: 100, default: 18 }, max: { type: Number, min: 18, max: 100, default: 35 } },
        gender: { type: String, enum: Object.values(GenderPreference), default: GenderPreference.ANY },
        lifestyle: {
          smoking: { type: String, enum: ['yes', 'no', 'prefer_not'], default: 'no' },
          pets: { type: String, enum: ['yes', 'no', 'prefer_not'], default: 'prefer_not' },
          partying: { type: String, enum: ['yes', 'no', 'prefer_not'], default: 'no' },
          cleanliness: { type: String, enum: ['very_clean', 'clean', 'average', 'relaxed'], default: 'clean' },
          schedule: { type: String, enum: ['early_bird', 'night_owl', 'flexible'], default: 'flexible' },
        },
        budget: { min: { type: Number, min: 0, default: 800 }, max: { type: Number, min: 0, default: 1500 } },
        moveInDate: { type: Date },
        leaseDuration: { type: String, enum: Object.values(LeaseDuration), default: LeaseDuration.YEARLY },
      },
      history: [{
        startDate: { type: Date, required: true },
        endDate: { type: Date },
        location: { type: String, required: true },
        roommateCount: { type: Number, min: 1 },
        reason: { type: String, trim: true },
      }],
    },
    language: { type: String, default: 'en' },
    timezone: { type: String, default: 'UTC' },
    currency: { type: String, default: 'USD' },
  },
  chatHistory: [{
    role: { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  }],
}, { _id: false });

const agencyProfileSchema = new mongoose.Schema({
  businessType: {
    type: String,
    enum: ['real_estate_agency', 'property_management', 'brokerage', 'developer', 'other'],
    required: true,
  },
  legalCompanyName: { type: String, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 1000 },
  businessDetails: {
    licenseNumber: String,
    taxId: String,
    yearEstablished: Number,
    employeeCount: { type: String, enum: ['1-10', '11-50', '51-200', '200+'] },
    specialties: [{ type: String, enum: ['residential', 'commercial', 'luxury', 'student_housing', 'senior_housing', 'vacation_rentals'] }],
    serviceAreas: [{ city: String, state: String, radius: Number }],
  },
  verification: {
    businessLicense: { type: Boolean, default: false },
    insurance: { type: Boolean, default: false },
    bonding: { type: Boolean, default: false },
    backgroundCheck: { type: Boolean, default: false },
  },
  ratings: {
    average: { type: Number, min: 0, max: 5, default: 0 },
    count: { type: Number, default: 0 },
  },
}, { _id: false });

const businessProfileSchema = new mongoose.Schema({
  businessType: {
    type: String,
    enum: ['small_business', 'startup', 'freelancer', 'consultant', 'other'],
    required: true,
  },
  legalCompanyName: { type: String, trim: true },
  description: { type: String, maxlength: 1000 },
  businessDetails: {
    licenseNumber: { type: String, trim: true },
    taxId: { type: String, trim: true },
    yearEstablished: { type: Number, min: 1900, max: new Date().getFullYear() },
    employeeCount: { type: String, enum: ['1-5', '6-10', '11-25', '26+'] },
    industry: { type: String, trim: true },
    specialties: [{ type: String, trim: true, lowercase: true }],
    serviceAreas: [{
      city: { type: String, required: true, trim: true },
      state: { type: String, required: true, trim: true },
      radius: { type: Number, min: 1, max: 100, default: 10 },
    }],
  },
  verification: {
    businessLicense: { type: Boolean, default: false },
    insurance: { type: Boolean, default: false },
    backgroundCheck: { type: Boolean, default: false },
  },
  ratings: {
    average: { type: Number, min: 0, max: 5, default: 0 },
    count: { type: Number, default: 0 },
  },
}, { _id: false });

const profileSchema = new mongoose.Schema({
  oxyUserId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  personalProfile: { type: personalProfileSchema },
  agencyProfile: { type: agencyProfileSchema },
  businessProfile: { type: businessProfileSchema },
  cooperativeProfile: {
    legalName: { type: String, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
  },
}, {
  timestamps: true,
});

profileSchema.index({ createdAt: -1 });
profileSchema.index({ updatedAt: -1 });

profileSchema.virtual('isVerified').get(function (this: IProfile): boolean {
  const personal = this.personalProfile as { verification?: { identity?: boolean; income?: boolean } } | undefined;
  const agency = this.agencyProfile as { verification?: { businessLicense?: boolean; insurance?: boolean } } | undefined;
  if (personal?.verification) {
    return Boolean(personal.verification.identity && personal.verification.income);
  }
  if (agency?.verification) {
    return Boolean(agency.verification.businessLicense && agency.verification.insurance);
  }
  return false;
});

profileSchema.statics.findByOxyUserId = function (oxyUserId: string, select: string | null = null) {
  const query = this.findOne({ oxyUserId });
  if (select) query.select(select);
  return query;
};

profileSchema.statics.findOrCreateByOxyUserId = async function (oxyUserId: string) {
  let profile = await this.findOne({ oxyUserId });
  if (!profile) {
    profile = new this({
      oxyUserId,
      personalProfile: DEFAULT_PERSONAL_PROFILE,
    });
    await profile.save();
  }
  return profile;
};

profileSchema.statics.findByOxyUserIdAndUpdate = function (
  oxyUserId: string,
  updateData: Record<string, unknown>,
) {
  return this.findOneAndUpdate({ oxyUserId }, updateData, { new: true, runValidators: true });
};

profileSchema.set('toJSON', {
  transform(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

module.exports = mongoose.model('Profile', profileSchema);
