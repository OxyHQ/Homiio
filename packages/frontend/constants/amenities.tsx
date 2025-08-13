import { Ionicons } from '@expo/vector-icons';

export interface Amenity {
  id: string;
  name: string;
  nameKey?: string; // Translation key for the name
  icon: keyof typeof Ionicons.glyphMap;
  category: string;
  description?: string;
  descriptionKey?: string; // Translation key for description
  essential?: boolean; // Basic necessity for dignified living
  accessibility?: boolean; // Supports accessibility and universal design
  environmental?: 'positive' | 'neutral' | 'negative'; // Environmental impact
  ethicalNotes?: string;
  ethicalNotesKey?: string; // Translation key for ethical notes
  maxFairValue?: number; // Maximum ethical value add in USD (many should be 0)
}

export interface AmenityCategory {
  id: string;
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  ethicalPriority?: 'high' | 'medium' | 'low'; // How important this category is for ethical housing
}

// Ethical guidelines for fair housing
export const ETHICAL_AMENITY_GUIDELINES = {
  maxValueAddPercentage: 10, // No single amenity should add more than 10% to base rent
  maxTotalAmenityValue: 200, // Total amenity value shouldn't exceed $200/month
  accessibilityAmenitiesMaxValue: 0, // Accessibility features should never increase rent
  essentialAmenitiesMaxValue: 30, // Essential amenities should have minimal value add
  transparencyRequired: true, // All amenity values must be disclosed to tenants
  fairHousingCompliance: true, // Must comply with fair housing laws
  noDiscrimination: true, // Amenities cannot be used to discriminate
};

export const AMENITY_CATEGORIES: AmenityCategory[] = [
  {
    id: 'essential',
    name: 'Essential Services',
    icon: 'home',
    color: '#2563eb',
    ethicalPriority: 'high',
  },
  {
    id: 'accessibility',
    name: 'Accessibility & Universal Design',
    icon: 'accessibility',
    color: '#6366f1',
    ethicalPriority: 'high',
  },
  {
    id: 'comfort',
    name: 'Comfort & Climate',
    icon: 'thermometer',
    color: '#dc2626',
    ethicalPriority: 'high',
  },
  {
    id: 'kitchen',
    name: 'Kitchen & Dining',
    icon: 'restaurant',
    color: '#ea580c',
    ethicalPriority: 'medium',
  },
  {
    id: 'eco',
    name: 'Environmental Sustainability',
    icon: 'leaf',
    color: '#059669',
    ethicalPriority: 'high',
  },
  {
    id: 'outdoor',
    name: 'Outdoor & Views',
    icon: 'leaf',
    color: '#16a34a',
    ethicalPriority: 'medium',
  },
  {
    id: 'wellness',
    name: 'Health & Wellness',
    icon: 'fitness',
    color: '#7c3aed',
    ethicalPriority: 'medium',
  },
  {
    id: 'technology',
    name: 'Digital Connectivity',
    icon: 'wifi',
    color: '#0891b2',
    ethicalPriority: 'high',
  },
  {
    id: 'security',
    name: 'Safety & Security',
    icon: 'shield-checkmark',
    color: '#be123c',
    ethicalPriority: 'high',
  },
  {
    id: 'storage',
    name: 'Storage & Organization',
    icon: 'cube',
    color: '#7c2d12',
    ethicalPriority: 'low',
  },
  {
    id: 'transportation',
    name: 'Transportation Access',
    icon: 'car',
    color: '#374151',
    ethicalPriority: 'medium',
  },
  {
    id: 'community',
    name: 'Community Spaces',
    icon: 'people',
    color: '#6366f1',
    ethicalPriority: 'medium',
  },
];

export const AMENITIES: Amenity[] = [
  // Essential Services - Basic necessities for dignified living
  {
    id: 'wifi',
    name: 'High-Speed Internet',
    nameKey: 'amenities.wifi',
    icon: 'wifi',
    category: 'essential',
    description: 'Reliable internet access for work, education, and communication',
    descriptionKey: 'amenities.wifi.description',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'Internet access is essential for employment, education, and civic participation',
    environmental: 'neutral',
  },
  {
    id: 'electricity',
    name: 'Electricity Included',
    nameKey: 'amenities.electricity',
    icon: 'flash',
    category: 'essential',
    description: 'Transparent electrical utility costs',
    descriptionKey: 'amenities.electricity.description',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'Basic utilities should be transparently priced, not used to hide costs',
    environmental: 'neutral',
  },
  {
    id: 'water',
    name: 'Water & Sewer Included',
    nameKey: 'amenities.water',
    icon: 'water',
    category: 'essential',
    description: 'Clean water and sewage services',
    descriptionKey: 'amenities.water.description',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'Access to clean water is a basic human right',
    environmental: 'neutral',
  },
  {
    id: 'heating',
    name: 'Adequate Heating',
    nameKey: 'amenities.heating',
    icon: 'flame',
    category: 'essential',
    description: 'Reliable heating system for health and safety',
    descriptionKey: 'amenities.heating.description',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'Adequate heating is essential for habitability and health',
    environmental: 'neutral',
  },
  {
    id: 'trash_pickup',
    name: 'Waste Collection',
    nameKey: 'amenities.trashPickup',
    icon: 'trash',
    category: 'essential',
    description: 'Regular waste collection service',
    descriptionKey: 'amenities.trashPickup.description',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'Basic sanitation services should be included in all rentals',
    environmental: 'positive',
  },

  // Accessibility & Universal Design - NO VALUE ADD (Legal & Ethical requirement)
  {
    id: 'wheelchair_accessible',
    name: 'Wheelchair Accessible',
    icon: 'accessibility',
    category: 'accessibility',
    description: 'Full ADA compliance with ramps, wide doorways, and accessible bathrooms',
    accessibility: true,
    maxFairValue: 0, // Accessibility features should never increase rent
    ethicalNotes: 'Required by law for fair housing. Should never be used to justify higher rent.',
    environmental: 'neutral',
  },
  {
    id: 'elevator',
    name: 'Elevator Access',
    icon: 'arrow-up',
    category: 'accessibility',
    description: 'Building elevator for multi-floor access',
    accessibility: true,
    maxFairValue: 0, // Essential for accessibility
    ethicalNotes: 'Essential for people with mobility challenges and elderly residents',
    environmental: 'neutral',
  },
  {
    id: 'grab_bars',
    name: 'Safety Grab Bars',
    icon: 'hand-right',
    category: 'accessibility',
    description: 'Bathroom safety grab bars and support rails',
    accessibility: true,
    maxFairValue: 0, // Safety features should not add cost
    ethicalNotes: 'Safety features should be standard, not premium add-ons',
    environmental: 'neutral',
  },
  {
    id: 'wide_doorways',
    name: 'Wide Doorways',
    icon: 'resize',
    category: 'accessibility',
    description: 'Extra-wide doorways for accessibility',
    accessibility: true,
    maxFairValue: 0, // Universal design should not add cost
    ethicalNotes: 'Universal design benefits everyone and should be standard',
    environmental: 'neutral',
  },
  {
    id: 'ramp_access',
    name: 'Ramp Access',
    icon: 'trending-up',
    category: 'accessibility',
    description: 'Wheelchair ramp access to building',
    accessibility: true,
    maxFairValue: 0, // Required accessibility feature
    ethicalNotes: 'ADA compliance is legally required, not a premium feature',
    environmental: 'neutral',
  },

  // Environmental Sustainability - Encouraged for planetary health
  {
    id: 'solar_panels',
    name: 'Solar Energy System',
    icon: 'sunny',
    category: 'eco',
    description: 'Renewable energy reducing environmental impact',
    maxFairValue: 25, // Moderate value for environmental benefit
    ethicalNotes: 'Promotes environmental responsibility and can reduce tenant utility costs',
    environmental: 'positive',
  },
  {
    id: 'energy_efficient',
    name: 'Energy Star Appliances',
    icon: 'leaf',
    category: 'eco',
    description: 'ENERGY STAR certified appliances for efficiency',
    maxFairValue: 15, // Reasonable value for efficiency
    ethicalNotes: 'Reduces environmental impact and tenant utility costs',
    environmental: 'positive',
  },
  {
    id: 'recycling_program',
    name: 'Comprehensive Recycling',
    icon: 'refresh',
    category: 'eco',
    description: 'Full recycling and composting programs',
    maxFairValue: 0, // Environmental responsibility should be standard
    ethicalNotes: 'Environmental stewardship should be a standard practice',
    environmental: 'positive',
  },
  {
    id: 'green_roof',
    name: 'Living Roof System',
    icon: 'leaf',
    category: 'eco',
    description: 'Green roof with plants for insulation and air quality',
    maxFairValue: 30, // Value for significant environmental benefit
    ethicalNotes: 'Significant environmental benefit that improves air quality for the community',
    environmental: 'positive',
  },
  {
    id: 'rainwater_collection',
    name: 'Rainwater Harvesting',
    icon: 'water',
    category: 'eco',
    description: 'Rainwater collection system for sustainability',
    maxFairValue: 20, // Value for water conservation
    ethicalNotes: 'Water conservation benefits the community and environment',
    environmental: 'positive',
  },

  // Comfort & Climate - Essential for habitability in changing climate
  {
    id: 'air_conditioning',
    name: 'Air Conditioning',
    icon: 'snow',
    category: 'comfort',
    description: 'Cooling system for health and safety in hot weather',
    maxFairValue: 35, // Reasonable value - becoming essential due to climate change
    ethicalNotes: 'Becoming essential for health and safety due to climate change',
    environmental: 'negative',
  },
  {
    id: 'insulation',
    name: 'Proper Insulation',
    icon: 'shield',
    category: 'comfort',
    description: 'Well-insulated for energy efficiency and comfort',
    maxFairValue: 10, // Low value as it should be standard
    ethicalNotes: 'Proper insulation should be standard for energy efficiency',
    environmental: 'positive',
  },
  {
    id: 'ceiling_fans',
    name: 'Ceiling Fans',
    icon: 'refresh',
    category: 'comfort',
    description: 'Energy-efficient ceiling fans for air circulation',
    maxFairValue: 10, // Low value for energy-efficient cooling
    ethicalNotes: 'Energy-efficient alternative to air conditioning',
    environmental: 'positive',
  },

  // Kitchen & Dining - Basic appliances for nutrition and health
  {
    id: 'refrigerator',
    name: 'Full-Size Refrigerator',
    icon: 'snow',
    category: 'kitchen',
    description: 'Essential food storage appliance',
    essential: true,
    maxFairValue: 15, // Minimal value as it's essential
    ethicalNotes: 'Essential appliance for food safety and nutrition',
    environmental: 'neutral',
  },
  {
    id: 'stove',
    name: 'Cooking Range',
    icon: 'flame',
    category: 'kitchen',
    description: 'Gas or electric cooking range for food preparation',
    essential: true,
    maxFairValue: 15, // Essential for food preparation
    ethicalNotes: 'Essential for food preparation and nutrition',
    environmental: 'neutral',
  },
  {
    id: 'oven',
    name: 'Oven',
    icon: 'flame',
    category: 'kitchen',
    description: 'Built-in oven for cooking and baking',
    essential: true,
    maxFairValue: 15, // Essential cooking appliance
    ethicalNotes: 'Essential for complete food preparation',
    environmental: 'neutral',
  },
  {
    id: 'microwave',
    name: 'Microwave',
    icon: 'radio',
    category: 'kitchen',
    description: 'Energy-efficient microwave for quick food preparation',
    maxFairValue: 10, // Low value for convenience
    ethicalNotes: 'Convenient and energy-efficient food preparation',
    environmental: 'positive',
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    icon: 'water',
    category: 'kitchen',
    description: 'Energy-efficient dishwasher',
    maxFairValue: 25, // Moderate value for water efficiency
    ethicalNotes: 'Saves water compared to hand washing when energy efficient',
    environmental: 'positive',
  },

  // Laundry - Essential for dignity and health
  {
    id: 'washing_machine',
    name: 'In-Unit Washer',
    icon: 'shirt',
    category: 'essential',
    description: 'Private washing machine in unit',
    maxFairValue: 30, // Reasonable value for privacy and convenience
    ethicalNotes: 'Provides dignity and convenience, especially important for families',
    environmental: 'neutral',
  },
  {
    id: 'dryer',
    name: 'In-Unit Dryer',
    icon: 'shirt',
    category: 'essential',
    description: 'Private clothes dryer in unit',
    maxFairValue: 20, // Reasonable value for convenience
    ethicalNotes: 'Complements washing facilities for complete laundry solution',
    environmental: 'neutral',
  },
  {
    id: 'laundry_room',
    name: 'Shared Laundry Facility',
    icon: 'business',
    category: 'essential',
    description: 'Clean, well-maintained shared laundry room',
    essential: true,
    maxFairValue: 5, // Minimal value as it's shared and essential
    ethicalNotes: 'Basic necessity should be clean, safe, and affordable to use',
    environmental: 'positive',
  },

  // Transportation - Important for equity and access to opportunities
  {
    id: 'bike_storage',
    name: 'Secure Bike Storage',
    icon: 'bicycle',
    category: 'transportation',
    description: 'Safe bicycle storage facility',
    maxFairValue: 10, // Low value to encourage sustainable transport
    ethicalNotes: 'Promotes sustainable transportation and should be affordable',
    environmental: 'positive',
  },
  {
    id: 'parking_space',
    name: 'Parking Space',
    icon: 'car',
    category: 'transportation',
    description: 'Assigned parking spot',
    maxFairValue: 40, // Moderate value but should reflect actual cost
    ethicalNotes: 'Should be priced fairly based on actual costs, not inflated',
    environmental: 'negative',
  },
  {
    id: 'ev_charging',
    name: 'Electric Vehicle Charging',
    icon: 'battery-charging',
    category: 'transportation',
    description: 'Electric vehicle charging station access',
    maxFairValue: 30, // Reasonable value for supporting clean transportation
    ethicalNotes: 'Supports transition to clean transportation',
    environmental: 'positive',
  },
  {
    id: 'public_transit_access',
    name: 'Public Transit Access',
    icon: 'bus',
    category: 'transportation',
    description: 'Close proximity to public transportation',
    maxFairValue: 0, // Location benefit shouldn't add extra cost
    ethicalNotes: 'Access to public transit promotes equity and should not justify premium pricing',
    environmental: 'positive',
  },

  // Safety & Security - Essential for well-being and peace of mind
  {
    id: 'fire_safety',
    name: 'Fire Safety System',
    icon: 'flame',
    category: 'security',
    description: 'Sprinklers, alarms, and emergency systems',
    essential: true,
    maxFairValue: 0, // Life safety should never add cost
    ethicalNotes: 'Life safety systems are legally required and should never justify higher rent',
    environmental: 'neutral',
  },
  {
    id: 'secure_entry',
    name: 'Controlled Access',
    icon: 'key',
    category: 'security',
    description: 'Secure building entry with access control',
    maxFairValue: 15, // Low value as basic security should be standard
    ethicalNotes: 'Basic security should be standard, not a premium feature',
    environmental: 'neutral',
  },
  {
    id: 'security_cameras',
    name: 'Security Cameras',
    icon: 'videocam',
    category: 'security',
    description: 'CCTV surveillance in common areas (with privacy protections)',
    maxFairValue: 20, // Moderate value for security
    ethicalNotes: 'Security cameras should respect privacy and be used ethically',
    environmental: 'neutral',
  },
  {
    id: 'intercom',
    name: 'Intercom System',
    icon: 'chatbubble',
    category: 'security',
    description: 'Building intercom for visitor communication',
    maxFairValue: 10, // Low value for basic communication
    ethicalNotes: 'Basic communication system for security and convenience',
    environmental: 'neutral',
  },

  // Storage & Organization - Basic needs
  {
    id: 'storage_unit',
    name: 'Storage Space',
    icon: 'cube',
    category: 'storage',
    description: 'Additional storage space',
    maxFairValue: 25, // Reasonable value for extra space
    ethicalNotes: 'Extra storage should be priced fairly based on space provided',
    environmental: 'neutral',
  },
  {
    id: 'walk_in_closet',
    name: 'Walk-in Closet',
    icon: 'shirt',
    category: 'storage',
    description: 'Large walk-in closet space',
    maxFairValue: 20, // Reasonable value for convenience
    ethicalNotes: 'Adequate storage is important for organized living',
    environmental: 'neutral',
  },
  {
    id: 'pantry',
    name: 'Kitchen Pantry',
    icon: 'library',
    category: 'storage',
    description: 'Kitchen pantry for food storage',
    maxFairValue: 10, // Low value for basic kitchen storage
    ethicalNotes: 'Adequate food storage supports healthy eating',
    environmental: 'neutral',
  },

  // Community & Wellness - Important for social well-being
  {
    id: 'community_room',
    name: 'Community Room',
    icon: 'people',
    category: 'community',
    description: 'Shared community space for residents',
    maxFairValue: 15, // Low value for community building
    ethicalNotes: 'Community spaces promote social connection and mental health',
    environmental: 'positive',
  },
  {
    id: 'gym',
    name: 'Fitness Center',
    icon: 'fitness',
    category: 'wellness',
    description: 'On-site fitness facility',
    maxFairValue: 30, // Moderate value for health benefits
    ethicalNotes: 'Promotes health and wellness in the community',
    environmental: 'positive',
  },
  {
    id: 'playground',
    name: "Children's Playground",
    icon: 'happy',
    category: 'community',
    description: 'Safe playground area for children',
    maxFairValue: 15, // Low value to support families
    ethicalNotes: 'Essential for families with children - should be affordable',
    environmental: 'positive',
  },
  {
    id: 'garden_space',
    name: 'Community Garden',
    icon: 'flower',
    category: 'community',
    description: 'Shared gardening space for residents',
    maxFairValue: 10, // Low value for community benefit
    ethicalNotes: 'Promotes community, sustainability, and food security',
    environmental: 'positive',
  },

  // Technology - Essential for modern life
  {
    id: 'fiber_internet',
    name: 'Fiber Internet',
    icon: 'wifi',
    category: 'technology',
    description: 'Ultra-high-speed fiber internet connection',
    maxFairValue: 20, // Reasonable value for premium internet
    ethicalNotes:
      'High-speed internet supports work, education, and participation in digital society',
    environmental: 'neutral',
  },
  {
    id: 'cable_tv',
    name: 'Cable TV Ready',
    icon: 'tv',
    category: 'technology',
    description: 'Pre-wired for cable television service',
    maxFairValue: 15, // Low value for basic connectivity
    ethicalNotes: 'Basic entertainment infrastructure',
    environmental: 'neutral',
  },

  // Outdoor & Views - Quality of life improvements
  {
    id: 'balcony',
    name: 'Private Balcony',
    icon: 'leaf',
    category: 'outdoor',
    description: 'Private outdoor balcony space',
    maxFairValue: 25, // Reasonable value for private outdoor space
    ethicalNotes: 'Outdoor space improves mental health and quality of life',
    environmental: 'positive',
  },
  {
    id: 'garden_access',
    name: 'Garden Access',
    icon: 'flower',
    category: 'outdoor',
    description: 'Access to shared garden space',
    maxFairValue: 10, // Low value for shared outdoor access
    ethicalNotes: 'Access to nature and outdoor space is important for well-being',
    environmental: 'positive',
  },
  {
    id: 'natural_light',
    name: 'Abundant Natural Light',
    icon: 'sunny',
    category: 'outdoor',
    description: 'Large windows and good natural light',
    maxFairValue: 0, // Natural light should be standard
    ethicalNotes: 'Natural light is essential for health and should be standard in all units',
    environmental: 'positive',
  },

  // Pet-Friendly - Reasonable accommodation for animal companions
  {
    id: 'pet_friendly',
    name: 'Pet-Friendly Policy',
    icon: 'paw',
    category: 'community',
    description: 'Welcomes pets with reasonable policies',
    maxFairValue: 20, // Moderate value but should not discriminate
    ethicalNotes:
      'Pet policies should be reasonable and not discriminatory. Service animals must be accommodated without fees.',
    environmental: 'neutral',
  },
  {
    id: 'dog_park',
    name: 'Pet Exercise Area',
    icon: 'paw',
    category: 'outdoor',
    description: 'Dedicated pet exercise and socialization area',
    maxFairValue: 15, // Low value for pet owners
    ethicalNotes: 'Promotes responsible pet ownership and community',
    environmental: 'positive',
  },

  // Work & Study - Essential in modern economy
  {
    id: 'home_office',
    name: 'Home Office Space',
    nameKey: 'amenities.homeOffice',
    icon: 'desktop',
    category: 'essential',
    description: 'Dedicated workspace area in unit',
    descriptionKey: 'amenities.homeOffice.description',
    maxFairValue: 30,
    ethicalNotes: 'Home office space is increasingly essential for employment and education',
    environmental: 'positive',
  },
  {
    id: 'coworking_space',
    name: 'Shared Workspace',
    nameKey: 'amenities.coworkingSpace',
    icon: 'people',
    category: 'community',
    description: 'Community coworking area',
    descriptionKey: 'amenities.coworkingSpace.description',
    maxFairValue: 20,
    ethicalNotes: 'Supports professional development and community building',
    environmental: 'positive',
  },
  {
    id: 'study_room',
    name: 'Quiet Study Space',
    nameKey: 'amenities.studyRoom',
    icon: 'library',
    category: 'community',
    description: 'Dedicated quiet space for study and reading',
    descriptionKey: 'amenities.studyRoom.description',
    maxFairValue: 10,
    ethicalNotes: 'Supports education and lifelong learning',
    environmental: 'positive',
  },

  // Additional Modern Amenities
  {
    id: 'smart_home',
    name: 'Smart Home Features',
    nameKey: 'amenities.smartHome',
    icon: 'home',
    category: 'technology',
    description: 'Smart thermostat, locks, and lighting controls',
    descriptionKey: 'amenities.smartHome.description',
    maxFairValue: 25,
    ethicalNotes: 'Smart features can improve energy efficiency and convenience',
    environmental: 'positive',
  },
  {
    id: 'usb_outlets',
    name: 'USB Charging Outlets',
    nameKey: 'amenities.usbOutlets',
    icon: 'battery-charging',
    category: 'technology',
    description: 'Built-in USB charging outlets throughout unit',
    descriptionKey: 'amenities.usbOutlets.description',
    maxFairValue: 5,
    ethicalNotes: 'Modern convenience that supports digital connectivity',
    environmental: 'neutral',
  },
  {
    id: 'smart_doorbell',
    name: 'Video Doorbell',
    nameKey: 'amenities.smartDoorbell',
    icon: 'videocam',
    category: 'security',
    description: 'Smart doorbell with video monitoring',
    descriptionKey: 'amenities.smartDoorbell.description',
    maxFairValue: 15,
    ethicalNotes: 'Enhances security while respecting privacy',
    environmental: 'neutral',
  },

  // Kitchen & Appliance Additions
  {
    id: 'garbage_disposal',
    name: 'Garbage Disposal',
    nameKey: 'amenities.garbageDisposal',
    icon: 'trash-bin',
    category: 'kitchen',
    description: 'In-sink garbage disposal unit',
    descriptionKey: 'amenities.garbageDisposal.description',
    maxFairValue: 10,
    ethicalNotes: 'Convenient and helps with waste management',
    environmental: 'positive',
  },
  {
    id: 'water_filter',
    name: 'Water Filtration System',
    nameKey: 'amenities.waterFilter',
    icon: 'water',
    category: 'essential',
    description: 'Built-in water filtration for clean drinking water',
    descriptionKey: 'amenities.waterFilter.description',
    maxFairValue: 15,
    ethicalNotes: 'Clean water access is essential for health',
    environmental: 'positive',
  },
  {
    id: 'ice_maker',
    name: 'Ice Maker',
    nameKey: 'amenities.iceMaker',
    icon: 'snow',
    category: 'kitchen',
    description: 'Built-in ice maker in refrigerator',
    descriptionKey: 'amenities.iceMaker.description',
    maxFairValue: 10,
    ethicalNotes: 'Convenience feature',
    environmental: 'neutral',
  },
  {
    id: 'wine_fridge',
    name: 'Wine Refrigerator',
    nameKey: 'amenities.wineFridge',
    icon: 'wine',
    category: 'kitchen',
    description: 'Dedicated wine storage refrigerator',
    descriptionKey: 'amenities.wineFridge.description',
    maxFairValue: 30,
    ethicalNotes: 'Luxury amenity should be fairly priced',
    environmental: 'neutral',
  },

  // Bathroom & Personal Care
  {
    id: 'jetted_tub',
    name: 'Jetted Tub',
    nameKey: 'amenities.jettedTub',
    icon: 'water',
    category: 'wellness',
    description: 'Luxury jetted bathtub for relaxation',
    descriptionKey: 'amenities.jettedTub.description',
    maxFairValue: 35,
    ethicalNotes: 'Wellness amenity that promotes relaxation',
    environmental: 'neutral',
  },
  {
    id: 'walk_in_shower',
    name: 'Walk-in Shower',
    nameKey: 'amenities.walkInShower',
    icon: 'water',
    category: 'accessibility',
    description: 'Accessible walk-in shower design',
    descriptionKey: 'amenities.walkInShower.description',
    accessibility: true,
    maxFairValue: 0,
    ethicalNotes: 'Accessibility feature should never add cost',
    environmental: 'neutral',
  },
  {
    id: 'double_vanity',
    name: 'Double Vanity',
    nameKey: 'amenities.doubleVanity',
    icon: 'water',
    category: 'comfort',
    description: 'Dual sink bathroom vanity',
    descriptionKey: 'amenities.doubleVanity.description',
    maxFairValue: 20,
    ethicalNotes: 'Convenience feature for couples and families',
    environmental: 'neutral',
  },
  {
    id: 'heated_floors',
    name: 'Heated Floors',
    nameKey: 'amenities.heatedFloors',
    icon: 'flame',
    category: 'comfort',
    description: 'Radiant floor heating system',
    descriptionKey: 'amenities.heatedFloors.description',
    maxFairValue: 40,
    ethicalNotes: 'Energy-efficient heating that improves comfort',
    environmental: 'positive',
  },

  // Flooring & Finishes
  {
    id: 'hardwood_floors',
    name: 'Hardwood Flooring',
    nameKey: 'amenities.hardwoodFloors',
    icon: 'library',
    category: 'comfort',
    description: 'Beautiful hardwood floors throughout',
    descriptionKey: 'amenities.hardwoodFloors.description',
    maxFairValue: 25,
    ethicalNotes: 'Durable flooring that improves air quality',
    environmental: 'positive',
  },
  {
    id: 'tile_floors',
    name: 'Tile Flooring',
    nameKey: 'amenities.tileFloors',
    icon: 'square',
    category: 'comfort',
    description: 'Easy-to-clean tile flooring',
    descriptionKey: 'amenities.tileFloors.description',
    maxFairValue: 15,
    ethicalNotes: 'Durable and easy to maintain',
    environmental: 'positive',
  },
  {
    id: 'granite_counters',
    name: 'Granite Countertops',
    nameKey: 'amenities.graniteCounters',
    icon: 'square',
    category: 'kitchen',
    description: 'Durable granite kitchen countertops',
    descriptionKey: 'amenities.graniteCounters.description',
    maxFairValue: 30,
    ethicalNotes: 'Durable surfaces that last longer',
    environmental: 'neutral',
  },
  {
    id: 'stainless_appliances',
    name: 'Stainless Steel Appliances',
    nameKey: 'amenities.stainlessAppliances',
    icon: 'square',
    category: 'kitchen',
    description: 'Modern stainless steel appliance package',
    descriptionKey: 'amenities.stainlessAppliances.description',
    maxFairValue: 35,
    ethicalNotes: 'Durable appliances that are easy to clean',
    environmental: 'neutral',
  },

  // Lighting & Electrical
  {
    id: 'led_lighting',
    name: 'LED Lighting',
    nameKey: 'amenities.ledLighting',
    icon: 'bulb',
    category: 'eco',
    description: 'Energy-efficient LED lighting throughout',
    descriptionKey: 'amenities.ledLighting.description',
    maxFairValue: 10,
    ethicalNotes: 'Energy-efficient lighting reduces costs and environmental impact',
    environmental: 'positive',
  },
  {
    id: 'dimmer_switches',
    name: 'Dimmer Switches',
    nameKey: 'amenities.dimmerSwitches',
    icon: 'options',
    category: 'comfort',
    description: 'Adjustable lighting with dimmer controls',
    descriptionKey: 'amenities.dimmerSwitches.description',
    maxFairValue: 10,
    ethicalNotes: 'Energy-saving and comfort feature',
    environmental: 'positive',
  },
  {
    id: 'pendant_lighting',
    name: 'Designer Lighting',
    nameKey: 'amenities.pendantLighting',
    icon: 'bulb',
    category: 'comfort',
    description: 'Stylish pendant and designer light fixtures',
    descriptionKey: 'amenities.pendantLighting.description',
    maxFairValue: 20,
    ethicalNotes: 'Aesthetic improvement that enhances living experience',
    environmental: 'neutral',
  },

  // Climate & Air Quality
  {
    id: 'whole_house_fan',
    name: 'Whole House Fan',
    nameKey: 'amenities.wholeHouseFan',
    icon: 'refresh-circle',
    category: 'comfort',
    description: 'Energy-efficient whole house ventilation fan',
    descriptionKey: 'amenities.wholeHouseFan.description',
    maxFairValue: 20,
    ethicalNotes: 'Energy-efficient cooling alternative',
    environmental: 'positive',
  },
  {
    id: 'air_purifier',
    name: 'Air Purification System',
    nameKey: 'amenities.airPurifier',
    icon: 'leaf',
    category: 'wellness',
    description: 'Built-in air purification for better air quality',
    descriptionKey: 'amenities.airPurifier.description',
    maxFairValue: 25,
    ethicalNotes: 'Health benefit particularly important in urban areas',
    environmental: 'positive',
  },
  {
    id: 'humidifier',
    name: 'Whole-House Humidifier',
    nameKey: 'amenities.humidifier',
    icon: 'water',
    category: 'wellness',
    description: 'Integrated humidity control system',
    descriptionKey: 'amenities.humidifier.description',
    maxFairValue: 20,
    ethicalNotes: 'Health benefit for respiratory wellness',
    environmental: 'positive',
  },

  // Additional Storage Solutions
  {
    id: 'linen_closet',
    name: 'Linen Closet',
    nameKey: 'amenities.linenCloset',
    icon: 'library',
    category: 'storage',
    description: 'Dedicated linen and towel storage',
    descriptionKey: 'amenities.linenCloset.description',
    maxFairValue: 10,
    ethicalNotes: 'Basic storage need for organized living',
    environmental: 'neutral',
  },
  {
    id: 'coat_closet',
    name: 'Entry Coat Closet',
    nameKey: 'amenities.coatCloset',
    icon: 'shirt',
    category: 'storage',
    description: 'Entryway closet for coats and seasonal items',
    descriptionKey: 'amenities.coatCloset.description',
    maxFairValue: 10,
    ethicalNotes: 'Helps maintain organized entrance area',
    environmental: 'neutral',
  },
  {
    id: 'built_in_shelving',
    name: 'Built-in Shelving',
    nameKey: 'amenities.builtInShelving',
    icon: 'library',
    category: 'storage',
    description: 'Custom built-in storage shelving',
    descriptionKey: 'amenities.builtInShelving.description',
    maxFairValue: 25,
    ethicalNotes: 'Maximizes space efficiency',
    environmental: 'neutral',
  },

  // Outdoor & Recreation Additions
  {
    id: 'BBQ_area',
    name: 'BBQ/Grilling Area',
    nameKey: 'amenities.bbqArea',
    icon: 'flame',
    category: 'outdoor',
    description: 'Shared outdoor grilling facilities',
    descriptionKey: 'amenities.bbqArea.description',
    maxFairValue: 15,
    ethicalNotes: 'Community amenity that promotes social interaction',
    environmental: 'neutral',
  },
  {
    id: 'fire_pit',
    name: 'Fire Pit Area',
    nameKey: 'amenities.firePit',
    icon: 'bonfire',
    category: 'outdoor',
    description: 'Outdoor fire pit for community gatherings',
    descriptionKey: 'amenities.firePit.description',
    maxFairValue: 20,
    ethicalNotes: 'Community gathering space promotes social connection',
    environmental: 'neutral',
  },
  {
    id: 'rooftop_deck',
    name: 'Rooftop Deck',
    nameKey: 'amenities.rooftopDeck',
    icon: 'arrow-up-circle',
    category: 'outdoor',
    description: 'Shared rooftop deck with city views',
    descriptionKey: 'amenities.rooftopDeck.description',
    maxFairValue: 30,
    ethicalNotes: 'Premium outdoor space that benefits all residents',
    environmental: 'positive',
  },
  {
    id: 'swimming_pool',
    name: 'Swimming Pool',
    nameKey: 'amenities.swimmingPool',
    icon: 'water',
    category: 'wellness',
    description: 'Community swimming pool facility',
    descriptionKey: 'amenities.swimmingPool.description',
    maxFairValue: 40,
    ethicalNotes: 'Recreation and health amenity that serves community',
    environmental: 'neutral',
  },
  {
    id: 'hot_tub',
    name: 'Hot Tub/Spa',
    nameKey: 'amenities.hotTub',
    icon: 'water',
    category: 'wellness',
    description: 'Relaxing hot tub spa facility',
    descriptionKey: 'amenities.hotTub.description',
    maxFairValue: 25,
    ethicalNotes: 'Wellness amenity for relaxation and community',
    environmental: 'neutral',
  },

  // Family & Children Amenities
  {
    id: 'daycare',
    name: 'On-site Childcare',
    nameKey: 'amenities.daycare',
    icon: 'happy',
    category: 'community',
    description: 'Licensed childcare facility on premises',
    descriptionKey: 'amenities.daycare.description',
    maxFairValue: 50,
    ethicalNotes: 'Essential for working families - should be affordable and quality',
    environmental: 'positive',
  },
  {
    id: 'teen_room',
    name: 'Teen Activity Room',
    nameKey: 'amenities.teenRoom',
    icon: 'game-controller',
    category: 'community',
    description: 'Dedicated space for teenage residents',
    descriptionKey: 'amenities.teenRoom.description',
    maxFairValue: 15,
    ethicalNotes: 'Important for youth development and family support',
    environmental: 'positive',
  },
  {
    id: 'family_room',
    name: 'Family Activity Room',
    nameKey: 'amenities.familyRoom',
    icon: 'people',
    category: 'community',
    description: 'Large family-friendly community space',
    descriptionKey: 'amenities.familyRoom.description',
    maxFairValue: 20,
    ethicalNotes: 'Supports families and community building',
    environmental: 'positive',
  },

  // Senior & Accessibility Features
  {
    id: 'senior_services',
    name: 'Senior Support Services',
    nameKey: 'amenities.seniorServices',
    icon: 'heart',
    category: 'accessibility',
    description: 'On-site services for senior residents',
    descriptionKey: 'amenities.seniorServices.description',
    accessibility: true,
    maxFairValue: 0,
    ethicalNotes: 'Support services should be included for aging-in-place',
    environmental: 'positive',
  },
  {
    id: 'mobility_assistance',
    name: 'Mobility Assistance Features',
    nameKey: 'amenities.mobilityAssistance',
    icon: 'accessibility',
    category: 'accessibility',
    description: 'Various mobility support features throughout property',
    descriptionKey: 'amenities.mobilityAssistance.description',
    accessibility: true,
    maxFairValue: 0,
    ethicalNotes: 'Required accessibility features should never add cost',
    environmental: 'neutral',
  },

  // Business & Professional
  {
    id: 'conference_room',
    name: 'Conference Room',
    nameKey: 'amenities.conferenceRoom',
    icon: 'business',
    category: 'community',
    description: 'Professional meeting space for residents',
    descriptionKey: 'amenities.conferenceRoom.description',
    maxFairValue: 25,
    ethicalNotes: 'Supports professional development and remote work',
    environmental: 'positive',
  },
  {
    id: 'printing_station',
    name: 'Printing & Copy Center',
    nameKey: 'amenities.printingStation',
    icon: 'print',
    category: 'technology',
    description: 'Shared printing and copying facilities',
    descriptionKey: 'amenities.printingStation.description',
    maxFairValue: 10,
    ethicalNotes: 'Essential for students and remote workers',
    environmental: 'neutral',
  },
  {
    id: 'mail_room',
    name: 'Package & Mail Room',
    nameKey: 'amenities.mailRoom',
    icon: 'mail',
    category: 'essential',
    description: 'Secure package delivery and mail sorting',
    descriptionKey: 'amenities.mailRoom.description',
    essential: true,
    maxFairValue: 5,
    ethicalNotes: 'Secure mail delivery is essential in modern living',
    environmental: 'neutral',
  },
];

// Helper functions for ethical amenity management
export const getAmenityById = (id: string): Amenity | undefined => {
  return AMENITIES.find((amenity) => amenity.id === id);
};

export const getAmenitiesByCategory = (categoryId: string): Amenity[] => {
  return AMENITIES.filter((amenity) => amenity.category === categoryId);
};

export const getCategoryById = (id: string): AmenityCategory | undefined => {
  return AMENITY_CATEGORIES.find((category) => category.id === id);
};

export const getAccessibilityAmenities = (): Amenity[] => {
  return AMENITIES.filter((amenity) => amenity.accessibility);
};

export const getEcoFriendlyAmenities = (): Amenity[] => {
  return AMENITIES.filter((amenity) => amenity.environmental === 'positive');
};

export const getEssentialAmenities = (): Amenity[] => {
  return AMENITIES.filter((amenity) => amenity.essential);
};

// Calculate ethical amenity pricing with fair housing principles
export const calculateEthicalAmenityValue = (
  amenityIds: string[],
  baseRent: number,
): {
  totalValue: number;
  warnings: string[];
  ethicalScore: 'excellent' | 'good' | 'fair' | 'concerning';
} => {
  const selectedAmenities = amenityIds.map((id) => getAmenityById(id)).filter(Boolean) as Amenity[];
  const totalValue = selectedAmenities.reduce(
    (sum, amenity) => sum + (amenity.maxFairValue || 0),
    0,
  );
  const warnings: string[] = [];

  // Check for excessive pricing
  const percentageOfRent = (totalValue / baseRent) * 100;
  if (percentageOfRent > ETHICAL_AMENITY_GUIDELINES.maxValueAddPercentage) {
    warnings.push(
      `Amenity value (${percentageOfRent.toFixed(1)}%) exceeds ethical limit of ${ETHICAL_AMENITY_GUIDELINES.maxValueAddPercentage}%`,
    );
  }

  if (totalValue > ETHICAL_AMENITY_GUIDELINES.maxTotalAmenityValue) {
    warnings.push(
      `Total amenity value ($${totalValue}) exceeds ethical limit of $${ETHICAL_AMENITY_GUIDELINES.maxTotalAmenityValue}`,
    );
  }

  // Check for accessibility violations
  const accessibilityAmenities = selectedAmenities.filter((a) => a.accessibility);
  const accessibilityValue = accessibilityAmenities.reduce(
    (sum, amenity) => sum + (amenity.maxFairValue || 0),
    0,
  );
  if (accessibilityValue > 0) {
    warnings.push(
      'Accessibility features should never add to rent - this may violate fair housing laws',
    );
  }

  // Check for essential amenity overpricing
  const essentialAmenities = selectedAmenities.filter((a) => a.essential);
  const essentialValue = essentialAmenities.reduce(
    (sum, amenity) => sum + (amenity.maxFairValue || 0),
    0,
  );
  if (essentialValue > ETHICAL_AMENITY_GUIDELINES.essentialAmenitiesMaxValue) {
    warnings.push(
      `Essential amenities are overpriced ($${essentialValue} vs max $${ETHICAL_AMENITY_GUIDELINES.essentialAmenitiesMaxValue})`,
    );
  }

  // Determine ethical score
  let ethicalScore: 'excellent' | 'good' | 'fair' | 'concerning';
  if (
    warnings.length === 0 &&
    totalValue <= ETHICAL_AMENITY_GUIDELINES.maxTotalAmenityValue * 0.6
  ) {
    ethicalScore = 'excellent';
  } else if (warnings.length === 0) {
    ethicalScore = 'good';
  } else if (warnings.length <= 1) {
    ethicalScore = 'fair';
  } else {
    ethicalScore = 'concerning';
  }

  return { totalValue, warnings, ethicalScore };
};

// Check fair housing compliance
export const checkFairHousingCompliance = (
  amenityIds: string[],
): {
  compliant: boolean;
  violations: string[];
  recommendations: string[];
} => {
  const violations: string[] = [];
  const recommendations: string[] = [];

  // Check for discriminatory amenity combinations
  const hasAccessibility = amenityIds.some((id) => getAmenityById(id)?.accessibility);
  const hasEssential = amenityIds.some((id) => getAmenityById(id)?.essential);

  if (!hasEssential) {
    violations.push('Missing essential amenities for habitability');
    recommendations.push('Include basic utilities and heating/cooling');
  }

  if (!hasAccessibility) {
    recommendations.push('Consider adding accessibility features for universal design');
  }

  return {
    compliant: violations.length === 0,
    violations,
    recommendations,
  };
};

// Most important amenities for basic dignified living
export const ESSENTIAL_AMENITIES = [
  'wifi',
  'electricity',
  'water',
  'heating',
  'trash_pickup',
  'fire_safety',
  'laundry_room',
  'refrigerator',
  'stove',
  'natural_light',
];

// Amenities that promote equity and accessibility
export const EQUITY_FOCUSED_AMENITIES = [
  'wheelchair_accessible',
  'elevator',
  'grab_bars',
  'wide_doorways',
  'ramp_access',
  'public_transit_access',
  'bike_storage',
  'community_room',
  'playground',
];

// Popular amenities commonly selected by property owners for listings
export const POPULAR_AMENITIES = [
  'wifi',
  'air_conditioning',
  'washing_machine',
  'dryer',
  'dishwasher',
  'parking_space',
  'balcony',
  'hardwood_floors',
  'stainless_appliances',
  'pet_friendly',
  'gym',
  'swimming_pool',
];

// Property type-specific amenity functions
export const getAmenitiesByPropertyType = (propertyType: string): string[] => {
  switch (propertyType) {
    case 'apartment':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'refrigerator',
        'stove',
        'microwave',
        'dishwasher',
        'laundry',
        'parking',
        'elevator',
        'balcony',
        'storage',
        'security_system',
        'intercom',
        'package_reception',
      ];

    case 'house':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'refrigerator',
        'stove',
        'microwave',
        'dishwasher',
        'laundry',
        'parking',
        'garage',
        'garden',
        'patio',
        'fireplace',
        'storage',
        'security_system',
        'smoke_detector',
      ];

    case 'room':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen_access',
        'laundry_access',
        'parking',
        'storage',
        'security_system',
        'furnished',
      ];

    case 'studio':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'refrigerator',
        'stove',
        'microwave',
        'laundry',
        'parking',
        'elevator',
        'storage',
        'security_system',
        'furnished',
        'balcony',
      ];

    case 'duplex':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'refrigerator',
        'stove',
        'microwave',
        'dishwasher',
        'laundry',
        'parking',
        'garden',
        'patio',
        'fireplace',
        'storage',
        'security_system',
        'private_entrance',
      ];

    case 'penthouse':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'refrigerator',
        'stove',
        'microwave',
        'dishwasher',
        'laundry',
        'parking',
        'elevator',
        'rooftop_access',
        'balcony',
        'fireplace',
        'storage',
        'security_system',
        'concierge',
        'gym',
        'pool',
        'spa',
      ];

    case 'couchsurfing':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'kitchen_access',
        'laundry_access',
        'cultural_exchange',
        'local_guidance',
        'flexible_checkin',
      ];

    case 'roommates':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen_access',
        'laundry_access',
        'parking',
        'storage',
        'security_system',
        'shared_spaces',
        'community_events',
      ];

    case 'coliving':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'laundry',
        'parking',
        'storage',
        'security_system',
        'shared_spaces',
        'community_events',
        'gym',
        'workspace',
        'rooftop_access',
        'cleaning_service',
      ];

    case 'hostel':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen_access',
        'laundry_access',
        'parking',
        'storage',
        'security_system',
        'shared_spaces',
        'cleaning_service',
        'flexible_checkin',
        'cultural_exchange',
      ];

    case 'guesthouse':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'laundry',
        'parking',
        'storage',
        'security_system',
        'private_entrance',
        'cleaning_service',
        'flexible_checkin',
        'local_guidance',
      ];

    case 'campsite':
      return [
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'parking',
        'storage',
        'security_system',
        'outdoor_space',
        'fire_pit',
        'picnic_area',
        'shower_facilities',
      ];

    case 'boat':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'kitchen',
        'laundry',
        'parking',
        'storage',
        'security_system',
        'waterfront_view',
        'unique_experience',
      ];

    case 'treehouse':
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'kitchen',
        'laundry',
        'parking',
        'storage',
        'security_system',
        'unique_experience',
        'nature_immersion',
        'outdoor_space',
      ];

    case 'yurt':
      return [
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'kitchen',
        'laundry',
        'parking',
        'storage',
        'security_system',
        'unique_experience',
        'cultural_immersion',
        'outdoor_space',
      ];

    default:
      return [
        'wifi',
        'electricity',
        'water',
        'heating',
        'trash_pickup',
        'air_conditioning',
        'kitchen',
        'laundry',
        'parking',
        'storage',
      ];
  }
};

export const getAmenityDescriptionByPropertyType = (propertyType: string): string => {
  switch (propertyType) {
    case 'apartment':
      return 'Select amenities available in your apartment building';
    case 'house':
      return 'Choose amenities available in your house';
    case 'room':
      return 'Select amenities available to room tenants';
    case 'studio':
      return 'Choose amenities in your studio apartment';
    case 'duplex':
      return 'Select amenities available in your duplex';
    case 'penthouse':
      return 'Choose luxury amenities in your penthouse';
    case 'couchsurfing':
      return 'Select what you can offer to couchsurfers';
    case 'roommates':
      return 'Choose amenities available to roommates';
    case 'coliving':
      return 'Select community amenities in your co-living space';
    case 'hostel':
      return 'Choose amenities available to hostel guests';
    case 'guesthouse':
      return 'Select amenities for your guesthouse';
    case 'campsite':
      return 'Choose camping amenities and facilities';
    case 'boat':
      return 'Select amenities available on your boat';
    case 'treehouse':
      return 'Choose amenities in your treehouse';
    case 'yurt':
      return 'Select amenities in your yurt';
    default:
      return 'Select amenities available at your property';
  }
};
