import type { Types } from 'mongoose';
import type { ISavedPropertyFolder, ISavedFolderEntry } from '../documentTypes';

const mongoose = require('mongoose');

type ObjectIdLike = string | Types.ObjectId;
type FolderEntry = ISavedFolderEntry & { notes?: string; savedAt?: Date };

const savedPropertyFolderSchema = new mongoose.Schema({
  profileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Profile',
    required: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100,
  },
  description: {
    type: String,
    trim: true,
    maxlength: 500,
    default: '',
  },
  color: {
    type: String,
    default: '#3B82F6', // Default blue color
    validate: {
      validator: function(v: string) {
        return /^#[0-9A-F]{6}$/i.test(v);
      },
      message: 'Color must be a valid hex color code'
    }
  },
  icon: {
    type: String,
    default: 'folder-outline',
  },
  isDefault: {
    type: Boolean,
    default: false,
  },
  // Array of property objects with propertyId, notes, and savedAt
  properties: [{
    propertyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Property',
      required: true,
    },
    notes: {
      type: String,
      default: '',
    },
    savedAt: {
      type: Date,
      default: Date.now,
    },
  }],
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  timestamps: true,
});

// Compound index to ensure unique profileId + name combinations (case insensitive)
savedPropertyFolderSchema.index({ profileId: 1, name: 1 }, { 
  unique: true,
  collation: { locale: 'en', strength: 2 }
});

// Index for efficient property queries
savedPropertyFolderSchema.index({ 'properties.propertyId': 1 });

// Virtual for property count
savedPropertyFolderSchema.virtual('propertyCount').get(function(this: ISavedPropertyFolder): number {
  return this.properties.length;
});

// Method to add a property to this folder
savedPropertyFolderSchema.methods.addProperty = async function(
  this: ISavedPropertyFolder,
  propertyId: ObjectIdLike,
  notes: string = ''
) {
  // Check if property already exists in this folder
  const existingProperty = this.properties.find(
    (p: FolderEntry) => p.propertyId.toString() === propertyId.toString()
  );

  if (existingProperty) {
    // Update existing property
    existingProperty.notes = notes;
    existingProperty.savedAt = new Date();
  } else {
    // Add new property
    this.properties.push({
      propertyId,
      notes,
      savedAt: new Date(),
    });
  }

  return this.save();
};

// Method to remove a property from this folder
savedPropertyFolderSchema.methods.removeProperty = async function(
  this: ISavedPropertyFolder,
  propertyId: ObjectIdLike
) {
  const remaining = this.properties.filter(
    (p: FolderEntry) => p.propertyId.toString() !== propertyId.toString()
  );
  this.properties.splice(0, this.properties.length, ...remaining);
  return this.save();
};

// Method to check if a property exists in this folder
savedPropertyFolderSchema.methods.hasProperty = function(this: ISavedPropertyFolder, propertyId: ObjectIdLike): boolean {
  return this.properties.some((p: FolderEntry) => p.propertyId.toString() === propertyId.toString());
};

// Method to get property data
savedPropertyFolderSchema.methods.getProperty = function(this: ISavedPropertyFolder, propertyId: ObjectIdLike) {
  return this.properties.find((p: FolderEntry) => p.propertyId.toString() === propertyId.toString());
};

interface FolderWithGetProperty extends ISavedPropertyFolder {
  getProperty(id: ObjectIdLike): FolderEntry | undefined;
}

// Method to update property notes
savedPropertyFolderSchema.methods.updatePropertyNotes = async function(
  this: FolderWithGetProperty,
  propertyId: ObjectIdLike,
  notes: string
) {
  const property = this.getProperty(propertyId);
  if (property) {
    property.notes = notes;
    return this.save();
  }
  return false;
};

module.exports = mongoose.model('SavedPropertyFolder', savedPropertyFolderSchema); 