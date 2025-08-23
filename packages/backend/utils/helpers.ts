/**
 * Utility Functions
 * Common helper functions used across the application
 */

/**
 * Generate unique ID
 */
const generateId = (prefix = 'id') => {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Calculate distance between two coordinates
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(deg2rad(lat1)) * Math.cos(deg2rad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const d = R * c; // Distance in kilometers
  return d;
};

const deg2rad = (deg) => {
  return deg * (Math.PI/180);
};

/**
 * Format currency
 */
const formatCurrency = (amount, currency = 'USD') => {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency
  }).format(amount);
};

/**
 * Validate email format
 */
const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

/**
 * Sanitize string for database storage
 */
const sanitizeString = (str) => {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, '');
};

/**
 * Calculate pagination offset
 */
const calculateOffset = (page, limit) => {
  return (parseInt(page) - 1) * parseInt(limit);
};

/**
 * Generate slug from string
 */
const generateSlug = (text) => {
  return text
    .toLowerCase()
    .replace(/[^\w ]+/g, '')
    .replace(/ +/g, '-');
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Check if object is empty
 */
const isEmpty = (obj) => {
  return Object.keys(obj).length === 0 && obj.constructor === Object;
};

/**
 * Format date for display
 */
const formatDate = (date, locale = 'en-US') => {
  return new Date(date).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
};

/**
 * Generate random string
 */
const randomString = (length = 10) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Sleep/delay function
 */
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Transform address fields for Property documents
 * Converts populated addressId to address field
 */
const transformAddressFields = (obj) => {
  if (obj && obj.addressId && typeof obj.addressId === 'object' && obj.addressId._id) {
    obj.address = { ...obj.addressId };
    
    // Remove showAddressNumber from address object if present (legacy data cleanup)
    // showAddressNumber should only exist at property level, not address level
    if (obj.address.showAddressNumber !== undefined) {
      delete obj.address.showAddressNumber;
    }
    
    // Remove addressId from response - only return the aliased address
    delete obj.addressId;
  }
  return obj;
};



module.exports = {
  generateId,
  calculateDistance,
  formatCurrency,
  validateEmail,
  sanitizeString,
  calculateOffset,
  generateSlug,
  deepClone,
  isEmpty,
  formatDate,
  randomString,
  sleep,
  transformAddressFields
};
