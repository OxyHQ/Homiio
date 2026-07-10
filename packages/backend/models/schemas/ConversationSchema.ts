import type { IConversation, IConversationMessage } from '../documentTypes';

const mongoose = require('mongoose');

interface ConversationDoc extends IConversation {
  analytics: { messageCount: number; lastActivity: Date; totalTokens: number };
  sharing: { isShared: boolean; shareToken?: string; sharedAt?: Date; expiresAt?: Date };
}

// Message Schema for individual messages within a conversation
const messageSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['user', 'assistant', 'system'],
    required: true,
  },
  content: {
    type: String,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  attachments: [{
    type: {
      type: String,
      enum: ['file', 'image', 'document'],
    },
    name: String,
    url: String,
    size: Number,
  }],
}, { _id: true });

messageSchema.pre('validate', function(next: (err?: Error) => void): void {
  next();
});

// Conversation Schema for Sindi AI conversations
const conversationSchema = new mongoose.Schema({
  // Profile who owns this conversation
  oxyUserId: {
    type: String,
    required: true,
    index: true,
  },
  
  // Conversation metadata
  title: {
    type: String,
    required: true,
    trim: true,
    maxlength: [200, "Conversation title cannot exceed 200 characters"],
  },
  
  // Messages in the conversation
  messages: [messageSchema],
  
  // Conversation status
  status: {
    type: String,
    enum: ['active', 'archived', 'deleted'],
    default: 'active',
  },
  
  // Topic/category for organization
  topic: {
    type: String,
    enum: ['rent', 'repairs', 'lease', 'rights', 'general'],
    default: 'general',
  },
  
  // Conversation metadata
  metadata: {
    // Initial message that started the conversation
    initialMessage: String,
    
    // Source of conversation (quick action, example, manual)
    source: {
      type: String,
      enum: ['quick_action', 'example', 'manual', 'url_share'],
      default: 'manual',
    },
    
    // Language of the conversation
    language: {
      type: String,
      default: 'en',
    },
    
    // Tags for categorization
    tags: [{
      type: String,
      trim: true,
      lowercase: true,
    }],
  },
  
  // Sharing settings
  sharing: {
    isShared: {
      type: Boolean,
      default: false,
    },
    shareToken: {
      type: String,
      unique: true,
      sparse: true, // Only create index for non-null values
    },
    sharedAt: Date,
    expiresAt: Date,
  },
  
  // Analytics
  analytics: {
    messageCount: {
      type: Number,
      default: 0,
    },
    lastActivity: {
      type: Date,
      default: Date.now,
    },
    totalTokens: {
      type: Number,
      default: 0,
    },
  },
  
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Indexes for performance
conversationSchema.index({ oxyUserId: 1, createdAt: -1 });
conversationSchema.index({ oxyUserId: 1, status: 1, updatedAt: -1 });
conversationSchema.index({ 'sharing.expiresAt': 1 }, { expireAfterSeconds: 0 });

// Virtual for message count
conversationSchema.virtual('messageCount').get(function(this: ConversationDoc): number {
  return this.messages ? this.messages.length : 0;
});

// Virtual for last message
conversationSchema.virtual('lastMessage').get(function(this: ConversationDoc): IConversationMessage | null {
  if (this.messages && this.messages.length > 0) {
    return this.messages[this.messages.length - 1];
  }
  return null;
});

// Pre-save middleware to update analytics
conversationSchema.pre('save', function(this: ConversationDoc, next: (err?: Error) => void): void {
  if (this.messages) {
    this.analytics.messageCount = this.messages.length;
    this.analytics.lastActivity = new Date();

    // Generate title from first user message if title is "New Conversation" or not set
    if ((!this.title || this.title === 'New Conversation') && this.messages.length > 0) {
      const firstUserMessage = this.messages.find((m: IConversationMessage) => m.role === 'user');
      if (firstUserMessage) {
        // Take first 50 characters of the message as title
        this.title = firstUserMessage.content.substring(0, 50).trim();
        if (firstUserMessage.content.length > 50) {
          this.title += '...';
        }
      }
    }
  }
  next();
});

conversationSchema.post('save', function(_doc: unknown): void {
});

conversationSchema.pre('validate', function(next: (err?: Error) => void): void {
  next();
});

// Static methods
conversationSchema.statics.findByProfileId = function(oxyUserId: string, status: string = 'active') {
  return this.find({
    oxyUserId,
    status
  }).sort({ updatedAt: -1 });
};

conversationSchema.statics.findByShareToken = function(shareToken: string) {
  return this.findOne({
    'sharing.shareToken': shareToken,
    'sharing.isShared': true,
    'sharing.expiresAt': { $gt: new Date() }
  });
};

interface CreateConversationData {
  title?: string;
  topic?: string;
  initialMessage?: string;
  source?: string;
  language?: string;
  messages?: IConversationMessage[];
}

conversationSchema.statics.createConversation = function(oxyUserId: string, data: CreateConversationData) {
  return this.create({
    oxyUserId,
    title: data.title || 'New Conversation',
    topic: data.topic || 'general',
    metadata: {
      initialMessage: data.initialMessage,
      source: data.source || 'manual',
      language: data.language || 'en',
    },
    messages: data.messages || [],
  });
};

// Instance methods
type MessageRole = 'user' | 'assistant' | 'system';
type MessageAttachment = { type?: string; name?: string; url?: string; size?: number };

conversationSchema.methods.addMessage = function(
  this: ConversationDoc,
  role: MessageRole,
  content: string,
  attachments: MessageAttachment[] = []
) {
  this.messages.push({
    role,
    content,
    attachments,
    timestamp: new Date(),
  });

  return this.save().then((savedDoc: ConversationDoc) => {
    return savedDoc;
  });
};

conversationSchema.methods.generateShareToken = function(this: ConversationDoc, expiresInHours: number = 24) {
  const crypto = require('crypto');
  this.sharing.shareToken = crypto.randomBytes(32).toString('hex');
  this.sharing.isShared = true;
  this.sharing.sharedAt = new Date();
  this.sharing.expiresAt = new Date(Date.now() + (expiresInHours * 60 * 60 * 1000));
  return this.save();
};

conversationSchema.methods.revokeSharing = function(this: ConversationDoc) {
  this.sharing.isShared = false;
  this.sharing.shareToken = undefined;
  this.sharing.sharedAt = undefined;
  this.sharing.expiresAt = undefined;
  return this.save();
};

conversationSchema.methods.archive = function(this: ConversationDoc) {
  this.status = 'archived';
  return this.save();
};

conversationSchema.methods.restore = function(this: ConversationDoc) {
  this.status = 'active';
  return this.save();
};

conversationSchema.methods.softDelete = function(this: ConversationDoc) {
  this.status = 'deleted';
  return this.save();
};

// Transform _id to id for frontend compatibility
conversationSchema.set('toJSON', {
  transform: function(_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
  virtuals: true, // Include virtual fields
});

module.exports = mongoose.model("Conversation", conversationSchema);