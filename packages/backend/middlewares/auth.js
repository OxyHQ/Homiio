/**
 * Authentication Middleware
 * Handles user authentication and authorization
 */

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Verify JWT token middleware
 */
const verifyToken = (req, res, next) => {
  const token = req.header('Authorization')?.replace('Bearer ', '');
  
  if (!token) {
    return res.status(401).json({ 
      error: 'Access denied. No token provided.' 
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    req.userId = decoded.id || decoded.userId;
    next();
  } catch (error) {
    res.status(400).json({ 
      error: 'Invalid token.' 
    });
  }
};

/**
 * Role-based authorization middleware
 */
const authorize = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Authentication required.' 
      });
    }

    // Convert single role to array
    if (typeof roles === 'string') {
      roles = [roles];
    }

    // Check if user has required role
    if (roles.length && !roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions.' 
      });
    }

    next();
  };
};

/**
 * Property ownership verification
 */
const verifyPropertyOwnership = async (req, res, next) => {
  try {
    const propertyId = req.params.propertyId || req.body.propertyId;
    const userId = req.userId;

    // In a real implementation, you would check the database
    // For now, we'll assume the property service handles this
    // const property = await PropertyService.findById(propertyId);
    // if (property.ownerId !== userId) {
    //   return res.status(403).json({ error: 'Access denied to this property.' });
    // }

    next();
  } catch (error) {
    res.status(500).json({ 
      error: 'Error verifying property ownership.' 
    });
  }
};

/**
 * Lease participation verification
 */
const verifyLeaseParticipation = async (req, res, next) => {
  try {
    const leaseId = req.params.leaseId || req.body.leaseId;
    const userId = req.userId;

    // In a real implementation, you would check the database
    // const lease = await LeaseService.findById(leaseId);
    // if (lease.landlordId !== userId && lease.tenantId !== userId) {
    //   return res.status(403).json({ error: 'Access denied to this lease.' });
    // }

    next();
  } catch (error) {
    res.status(500).json({ 
      error: 'Error verifying lease participation.' 
    });
  }
};

/**
 * Device ownership verification
 */
const verifyDeviceAccess = async (req, res, next) => {
  try {
    const deviceId = req.params.deviceId || req.body.deviceId;
    const userId = req.userId;

    // In a real implementation, you would check device ownership
    // through property ownership or direct device assignment
    // const device = await DeviceService.findById(deviceId);
    // const property = await PropertyService.findById(device.propertyId);
    // if (property.ownerId !== userId && !device.authorizedUsers.includes(userId)) {
    //   return res.status(403).json({ error: 'Access denied to this device.' });
    // }

    next();
  } catch (error) {
    res.status(500).json({ 
      error: 'Error verifying device access.' 
    });
  }
};

/**
 * API Key validation for device endpoints
 */
const verifyDeviceApiKey = (req, res, next) => {
  const apiKey = req.header('X-Device-API-Key');
  
  if (!apiKey) {
    return res.status(401).json({ 
      error: 'Device API key required.' 
    });
  }

  // In a real implementation, validate against database
  // const device = await DeviceService.findByApiKey(apiKey);
  // if (!device) {
  //   return res.status(401).json({ error: 'Invalid device API key.' });
  // }
  // req.device = device;

  next();
};

/**
 * Rate limiting for sensitive operations
 */
const rateLimitSensitive = (req, res, next) => {
  // Implement rate limiting logic here
  // This would typically use Redis or a similar store
  next();
};

module.exports = {
  verifyToken,
  authorize,
  verifyPropertyOwnership,
  verifyLeaseParticipation,
  verifyDeviceAccess,
  verifyDeviceApiKey,
  rateLimitSensitive
};
