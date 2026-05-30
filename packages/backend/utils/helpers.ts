/**
 * Utility Functions
 * Common helper functions used across the application
 */

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
  transformAddressFields
};
