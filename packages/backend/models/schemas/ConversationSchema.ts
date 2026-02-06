const mongoose = require('mongoose');

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

messageSchema.pre('validate', function(next) {
  next();
});

// Conversation Schema for Sindi AI conversations
const conversationSchema = new mongoose.Schema({
  // Profile who owns this conversation
  profileId: {
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
conversationSchema.index({ profileId: 1, createdAt: -1 });
conversationSchema.index({ profileId: 1, status: 1, updatedAt: -1 });
conversationSchema.index({ 'sharing.expiresAt': 1 }, { expireAfterSeconds: 0 });

// Virtual for message count
conversationSchema.virtual('messageCount').get(function() {
  return this.messages ? this.messages.length : 0;
});

// Virtual for last message
conversationSchema.virtual('lastMessage').get(function() {
  if (this.messages && this.messages.length > 0) {
    return this.messages[this.messages.length - 1];
  }
  return null;
});

// Pre-save middleware to update analytics
conversationSchema.pre('save', function(next) {
  console.log('Pre-save middleware - messages count:', this.messages ? this.messages.length : 0);
  if (this.messages) {
    this.analytics.messageCount = this.messages.length;
    this.analytics.lastActivity = new Date();
    
    // Generate title from first user message if title is "New Conversation" or not set
    if ((!this.title || this.title === 'New Conversation') && this.messages.length > 0) {
      const firstUserMessage = this.messages.find(m => m.role === 'user');
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

// Post-save middleware to debug
conversationSchema.post('save', function(doc) {
  console.log('Post-save middleware - saved conversation messages count:', doc.messages ? doc.messages.length : 0);
});

// Add validation debugging to conversation schema
conversationSchema.pre('validate', function(next) {
  console.log('Conversation validation - messages count:', this.messages ? this.messages.length : 0);
  if (this.messages && this.messages.length > 0) {
    console.log('Conversation validation - first message:', {
      role: this.messages[0].role,
      content: this.messages[0].content ? this.messages[0].content.substring(0, 50) : 'undefined'
    });
  }
  next();
});

// Static methods
conversationSchema.statics.findByProfileId = function(profileId, status = 'active') {
  return this.find({ 
    profileId, 
    status 
  }).sort({ updatedAt: -1 });
};

conversationSchema.statics.findByShareToken = function(shareToken) {
  return this.findOne({ 
    'sharing.shareToken': shareToken,
    'sharing.isShared': true,
    'sharing.expiresAt': { $gt: new Date() }
  });
};

conversationSchema.statics.createConversation = function(profileId, data) {
  return this.create({
    profileId,
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
conversationSchema.methods.addMessage = function(role, content, attachments = []) {
  console.log('addMessage called with:', { role, content: content.substring(0, 50), attachmentsCount: attachments.length });
  console.log('Messages before adding:', this.messages.length);
  
  this.messages.push({
    role,
    content,
    attachments,
    timestamp: new Date(),
  });
  
  console.log('Messages after adding:', this.messages.length);
  console.log('About to save conversation with messages:', this.messages.length);
  return this.save().then(savedDoc => {
    console.log('Conversation saved successfully. Messages in saved doc:', savedDoc.messages.length);
    return savedDoc;
  });
};

conversationSchema.methods.generateShareToken = function(expiresInHours = 24) {
  const crypto = require('crypto');
  this.sharing.shareToken = crypto.randomBytes(32).toString('hex');
  this.sharing.isShared = true;
  this.sharing.sharedAt = new Date();
  this.sharing.expiresAt = new Date(Date.now() + (expiresInHours * 60 * 60 * 1000));
  return this.save();
};

conversationSchema.methods.revokeSharing = function() {
  this.sharing.isShared = false;
  this.sharing.shareToken = undefined;
  this.sharing.sharedAt = undefined;
  this.sharing.expiresAt = undefined;
  return this.save();
};

conversationSchema.methods.archive = function() {
  this.status = 'archived';
  return this.save();
};

conversationSchema.methods.restore = function() {
  this.status = 'active';
  return this.save();
};

conversationSchema.methods.softDelete = function() {
  this.status = 'deleted';
  return this.save();
};

// Transform _id to id for frontend compatibility
conversationSchema.set('toJSON', {
  transform: function(doc, ret) {
    ret.id = ret._id;
    delete ret._id;
    delete ret.__v;
    return ret;
  },
  virtuals: true, // Include virtual fields
});

module.exports = mongoose.model("Conversation", conversationSchema);