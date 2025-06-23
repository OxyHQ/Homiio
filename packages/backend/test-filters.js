/**
 * Test file for property filter parsing
 * Run with: node test-filters.js
 */

function parsePropertyFilters(query) {
  const filters = {};
  const lowerQuery = query.toLowerCase();
  
  // Price filters
  const priceMatch = lowerQuery.match(/(?:under|less than|max|maximum|up to|cheap|cheaper|budget)\s*\$?(\d+)/);
  if (priceMatch) {
    filters.maxRent = parseInt(priceMatch[1]);
  }
  
  const minPriceMatch = lowerQuery.match(/(?:over|more than|minimum|min)\s*\$?(\d+)/);
  if (minPriceMatch) {
    filters.minRent = parseInt(minPriceMatch[1]);
  }
  
  // Price range
  const rangeMatch = lowerQuery.match(/\$?(\d+)\s*(?:to|-)\s*\$?(\d+)/);
  if (rangeMatch) {
    filters.minRent = parseInt(rangeMatch[1]);
    filters.maxRent = parseInt(rangeMatch[2]);
  }
  
  // Location filters
  const locationKeywords = ['in', 'near', 'around', 'at', 'close to', 'within'];
  for (const keyword of locationKeywords) {
    const locationMatch = lowerQuery.match(new RegExp(`${keyword}\\s+([a-zA-Z\\s]+?)(?:\\s|$|,|\\?|\\!|\\d)`, 'i'));
    if (locationMatch) {
      filters.city = locationMatch[1].trim();
      break;
    }
  }
  
  // Property type filters
  const typeKeywords = {
    'apartment': ['apartment', 'apt', 'flat', 'pisos'],
    'house': ['house', 'home', 'casa'],
    'room': ['room', 'bedroom', 'habitación', 'habitacion'],
    'studio': ['studio', 'loft'],
    'shared': ['shared', 'coliving', 'co-living', 'roommate']
  };
  
  for (const [type, keywords] of Object.entries(typeKeywords)) {
    if (keywords.some(keyword => lowerQuery.includes(keyword))) {
      filters.type = type;
      break;
    }
  }
  
  // Bedroom filters
  const bedroomMatch = lowerQuery.match(/(\d+)\s*(?:bedroom|bed|br|room)s?/);
  if (bedroomMatch) {
    filters.bedrooms = parseInt(bedroomMatch[1]);
  }
  
  // Bathroom filters
  const bathroomMatch = lowerQuery.match(/(\d+)\s*(?:bathroom|bath|ba)s?/);
  if (bathroomMatch) {
    filters.bathrooms = parseInt(bathroomMatch[1]);
  }
  
  // Feature filters
  const featureKeywords = {
    'furnished': ['furnished', 'furniture', 'mobiliado'],
    'parking': ['parking', 'garage', 'estacionamiento'],
    'pet_friendly': ['pet', 'dog', 'cat', 'mascota', 'permiten mascotas'],
    'balcony': ['balcony', 'terrace', 'balcón', 'terraza'],
    'gym': ['gym', 'fitness', 'exercise'],
    'wifi': ['wifi', 'internet', 'wifi included'],
    'air_conditioning': ['ac', 'air conditioning', 'aire acondicionado'],
    'washer': ['washer', 'laundry', 'lavadora'],
    'dishwasher': ['dishwasher', 'lavavajillas'],
    'elevator': ['elevator', 'ascensor']
  };
  
  filters.amenities = [];
  for (const [feature, keywords] of Object.entries(featureKeywords)) {
    if (keywords.some(keyword => lowerQuery.includes(keyword))) {
      filters.amenities.push(feature);
    }
  }
  
  // Size filters
  const sizeMatch = lowerQuery.match(/(\d+)\s*(?:sq\s*ft|square\s*feet|m2|metros)/);
  if (sizeMatch) {
    filters.minSize = parseInt(sizeMatch[1]);
  }
  
  // Availability filters
  if (lowerQuery.includes('available now') || lowerQuery.includes('immediate') || lowerQuery.includes('urgent')) {
    filters.availableNow = true;
  }
  
  // Budget-friendly indicators
  if (lowerQuery.includes('cheap') || lowerQuery.includes('affordable') || lowerQuery.includes('budget') || lowerQuery.includes('económico')) {
    filters.budgetFriendly = true;
  }
  
  // Luxury indicators
  if (lowerQuery.includes('luxury') || lowerQuery.includes('premium') || lowerQuery.includes('high end') || lowerQuery.includes('lujo')) {
    filters.luxury = true;
  }
  
  return filters;
}

// Test cases
const testQueries = [
  "Find me cheap apartments under $1000 in Barcelona",
  "Show me pet-friendly apartments with parking under $1500",
  "I need furnished studios with wifi under $1200",
  "Find 3-bedroom houses with garden under $2000",
  "Show me luxury apartments with gym and pool over $3000",
  "Find shared rooms or coliving spaces under $800",
  "2-bedroom apartments in Madrid with balcony",
  "Properties between $800-$1200 with air conditioning",
  "Cheap furnished studios near the university",
  "Luxury properties with elevator and parking"
];

console.log("Testing Property Filter Parsing\n");
console.log("=" .repeat(50));

testQueries.forEach((query, index) => {
  console.log(`\n${index + 1}. Query: "${query}"`);
  const filters = parsePropertyFilters(query);
  console.log("   Filters:", JSON.stringify(filters, null, 2));
});

console.log("\n" + "=" .repeat(50));
console.log("Filter parsing test completed!"); 