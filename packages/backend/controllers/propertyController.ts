// Thin compatibility wrapper around refactored modular handlers
// Import individual handler functions
const propertyHandlers = require('./property');

class PropertyController { }

// Attach handlers to preserve existing interface (instance methods)
[
  'createProperty',
  'getProperties',
  'getPropertyById',
  'getMyProperties',
  'updateProperty',
  'deleteProperty',
  'searchProperties',
  'findNearbyProperties',
  'findPropertiesInRadius',
  'getPropertyStats',
  'getPropertiesByIds',
  'getPropertiesByOwner'
].forEach(name => {
  if (propertyHandlers[name]) {
    PropertyController.prototype[name] = propertyHandlers[name];
  }
});

module.exports = new PropertyController();
