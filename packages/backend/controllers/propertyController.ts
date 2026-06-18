// Thin compatibility wrapper around refactored modular handlers.
import * as propertyHandlers from './property';

class PropertyController { }

// Attach handlers to preserve existing interface (instance methods)
const handlerNames: Array<keyof typeof propertyHandlers> = [
  'createProperty',
  'getProperties',
  'getPropertyById',
  'getMyProperties',
  'updateProperty',
  'markPropertyTransacted',
  'deleteProperty',
  'searchProperties',
  'findNearbyProperties',
  'findPropertiesInRadius',
  'getPropertyStats',
  'getAreaInsights',
  'getPropertyNearbyServices',
  'getPropertiesByIds',
  'getPropertiesByOwner'
];

const controller = new PropertyController() as PropertyController &
  Partial<Record<keyof typeof propertyHandlers, unknown>>;

handlerNames.forEach((name) => {
  const handler = propertyHandlers[name];
  if (typeof handler === 'function') {
    controller[name] = handler;
  }
});

module.exports = controller;
