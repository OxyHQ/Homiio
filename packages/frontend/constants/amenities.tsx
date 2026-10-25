import type { ButtonIconComponent } from '@oxy.so/bloom/button';

import { RiAccessibilityLine } from '@oxy.so/bloom/icons/RiAccessibilityLine';
import { RiArrowRightUpLine } from '@oxy.so/bloom/icons/RiArrowRightUpLine';
import { RiArrowUpCircleLine } from '@oxy.so/bloom/icons/RiArrowUpCircleLine';
import { RiArrowUpLine } from '@oxy.so/bloom/icons/RiArrowUpLine';
import { RiBookOpenLine } from '@oxy.so/bloom/icons/RiBookOpenLine';
import { RiBox3Line } from '@oxy.so/bloom/icons/RiBox3Line';
import { RiBroadcastLine } from '@oxy.so/bloom/icons/RiBroadcastLine';
import { RiBuilding2Line } from '@oxy.so/bloom/icons/RiBuilding2Line';
import { RiCarLine } from '@oxy.so/bloom/icons/RiCarLine';
import { RiChat3Line } from '@oxy.so/bloom/icons/RiChat3Line';
import { RiComputerLine } from '@oxy.so/bloom/icons/RiComputerLine';
import { RiDeleteBin6Line } from '@oxy.so/bloom/icons/RiDeleteBin6Line';
import { RiDeleteBinLine } from '@oxy.so/bloom/icons/RiDeleteBinLine';
import { RiDropLine } from '@oxy.so/bloom/icons/RiDropLine';
import { RiEmotionHappyLine } from '@oxy.so/bloom/icons/RiEmotionHappyLine';
import { RiEqualizerLine } from '@oxy.so/bloom/icons/RiEqualizerLine';
import { RiExpandDiagonalSLine } from '@oxy.so/bloom/icons/RiExpandDiagonalSLine';
import { RiFireLine } from '@oxy.so/bloom/icons/RiFireLine';
import { RiFlowerLine } from '@oxy.so/bloom/icons/RiFlowerLine';
import { RiGamepadLine } from '@oxy.so/bloom/icons/RiGamepadLine';
import { RiGlobalLine } from '@oxy.so/bloom/icons/RiGlobalLine';
import { RiGroupLine } from '@oxy.so/bloom/icons/RiGroupLine';
import { RiHand } from '@oxy.so/bloom/icons/RiHand';
import { RiHeartLine } from '@oxy.so/bloom/icons/RiHeartLine';
import { RiHeartPulseLine } from '@oxy.so/bloom/icons/RiHeartPulseLine';
import { RiHomeHeartLine } from '@oxy.so/bloom/icons/RiHomeHeartLine';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { RiKey2Line } from '@oxy.so/bloom/icons/RiKey2Line';
import { RiLeafLine } from '@oxy.so/bloom/icons/RiLeafLine';
import { RiLightbulbLine } from '@oxy.so/bloom/icons/RiLightbulbLine';
import { RiLoopRightLine } from '@oxy.so/bloom/icons/RiLoopRightLine';
import { RiMacLine } from '@oxy.so/bloom/icons/RiMacLine';
import { RiMailLine } from '@oxy.so/bloom/icons/RiMailLine';
import { RiPlugLine } from '@oxy.so/bloom/icons/RiPlugLine';
import { RiPrinterLine } from '@oxy.so/bloom/icons/RiPrinterLine';
import { RiRectangleLine } from '@oxy.so/bloom/icons/RiRectangleLine';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';
import { RiRestaurantLine } from '@oxy.so/bloom/icons/RiRestaurantLine';
import { RiRouteLine } from '@oxy.so/bloom/icons/RiRouteLine';
import { RiShieldCheckLine } from '@oxy.so/bloom/icons/RiShieldCheckLine';
import { RiShieldLine } from '@oxy.so/bloom/icons/RiShieldLine';
import { RiShoppingBag3Line } from '@oxy.so/bloom/icons/RiShoppingBag3Line';
import { RiSnowflakeLine } from '@oxy.so/bloom/icons/RiSnowflakeLine';
import { RiSunFoggyLine } from '@oxy.so/bloom/icons/RiSunFoggyLine';
import { RiSunLine } from '@oxy.so/bloom/icons/RiSunLine';
import { RiVideoLine } from '@oxy.so/bloom/icons/RiVideoLine';
import { RiWalkLine } from '@oxy.so/bloom/icons/RiWalkLine';

export interface Amenity {
  id: string;
  name: string;
  nameKey?: string; // Translation key for the name
  /** Bloom (Remix) line icon component. */
  icon: ButtonIconComponent;
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

interface AmenityCategory {
  id: string;
  name: string;
  nameKey?: string; // Translation key for the category name
  /** Bloom (Remix) line icon component. */
  icon: ButtonIconComponent;
  color: string;
  ethicalPriority?: 'high' | 'medium' | 'low'; // How important this category is for ethical housing
}

// Per-category accent colors. This is a curated multi-hue category palette
// (one distinct hue per amenity group) used for icon tints, not Bloom theme
// tokens — kept as literals so the categories stay visually distinguishable.
const AMENITY_CATEGORIES: AmenityCategory[] = [
  {
    id: 'essential',
    name: 'Essentials',
    nameKey: 'amenities.categories.essential',
    icon: RiHomeLine,
    color: '#2563eb',
    ethicalPriority: 'high',
  },
  {
    id: 'accessibility',
    name: 'Accessibility',
    nameKey: 'amenities.categories.accessibility',
    icon: RiAccessibilityLine,
    color: '#6366f1',
    ethicalPriority: 'high',
  },
  {
    id: 'comfort',
    name: 'Heating & cooling',
    nameKey: 'amenities.categories.comfort',
    icon: RiSunFoggyLine,
    color: '#dc2626',
    ethicalPriority: 'high',
  },
  {
    id: 'kitchen',
    name: 'Kitchen & dining',
    nameKey: 'amenities.categories.kitchen',
    icon: RiRestaurantLine,
    color: '#ea580c',
    ethicalPriority: 'medium',
  },
  {
    id: 'eco',
    name: 'Sustainability',
    nameKey: 'amenities.categories.eco',
    icon: RiLeafLine,
    color: '#059669',
    ethicalPriority: 'high',
  },
  {
    id: 'outdoor',
    name: 'Outdoor & views',
    nameKey: 'amenities.categories.outdoor',
    icon: RiLeafLine,
    color: '#16a34a',
    ethicalPriority: 'medium',
  },
  {
    id: 'wellness',
    name: 'Health & wellness',
    nameKey: 'amenities.categories.wellness',
    icon: RiHeartPulseLine,
    color: '#7c3aed',
    ethicalPriority: 'medium',
  },
  {
    id: 'technology',
    name: 'Internet & office',
    nameKey: 'amenities.categories.technology',
    icon: RiGlobalLine,
    color: '#0891b2',
    ethicalPriority: 'high',
  },
  {
    id: 'security',
    name: 'Home safety',
    nameKey: 'amenities.categories.security',
    icon: RiShieldCheckLine,
    color: '#be123c',
    ethicalPriority: 'high',
  },
  {
    id: 'storage',
    name: 'Storage',
    nameKey: 'amenities.categories.storage',
    icon: RiBox3Line,
    color: '#7c2d12',
    ethicalPriority: 'low',
  },
  {
    id: 'transportation',
    name: 'Parking & transport',
    nameKey: 'amenities.categories.transportation',
    icon: RiCarLine,
    color: '#374151',
    ethicalPriority: 'medium',
  },
  {
    id: 'community',
    name: 'Community spaces',
    nameKey: 'amenities.categories.community',
    icon: RiGroupLine,
    color: '#6366f1',
    ethicalPriority: 'medium',
  },
];

const AMENITIES: Amenity[] = [
  // Essential Services - Basic necessities for dignified living
  {
    id: 'wifi',
    name: 'High-Speed Internet',
    nameKey: 'amenities.wifi',
    icon: RiGlobalLine,
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
    icon: RiPlugLine,
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
    icon: RiDropLine,
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
    icon: RiFireLine,
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
    icon: RiDeleteBinLine,
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
    nameKey: 'amenities.wheelchairAccessible',
    icon: RiAccessibilityLine,
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
    nameKey: 'amenities.elevator',
    icon: RiArrowUpLine,
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
    nameKey: 'amenities.grabBars',
    icon: RiHand,
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
    nameKey: 'amenities.wideDoorways',
    icon: RiExpandDiagonalSLine,
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
    nameKey: 'amenities.rampAccess',
    icon: RiArrowRightUpLine,
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
    nameKey: 'amenities.solarPanels',
    icon: RiSunLine,
    category: 'eco',
    description: 'Renewable energy reducing environmental impact',
    maxFairValue: 25, // Moderate value for environmental benefit
    ethicalNotes: 'Promotes environmental responsibility and can reduce tenant utility costs',
    environmental: 'positive',
  },
  {
    id: 'energy_efficient',
    name: 'Energy Star Appliances',
    nameKey: 'amenities.energyEfficient',
    icon: RiLeafLine,
    category: 'eco',
    description: 'ENERGY STAR certified appliances for efficiency',
    maxFairValue: 15, // Reasonable value for efficiency
    ethicalNotes: 'Reduces environmental impact and tenant utility costs',
    environmental: 'positive',
  },
  {
    id: 'recycling_program',
    name: 'Comprehensive Recycling',
    nameKey: 'amenities.recyclingProgram',
    icon: RiRefreshLine,
    category: 'eco',
    description: 'Full recycling and composting programs',
    maxFairValue: 0, // Environmental responsibility should be standard
    ethicalNotes: 'Environmental stewardship should be a standard practice',
    environmental: 'positive',
  },
  {
    id: 'green_roof',
    name: 'Living Roof System',
    nameKey: 'amenities.greenRoof',
    icon: RiLeafLine,
    category: 'eco',
    description: 'Green roof with plants for insulation and air quality',
    maxFairValue: 30, // Value for significant environmental benefit
    ethicalNotes: 'Significant environmental benefit that improves air quality for the community',
    environmental: 'positive',
  },
  {
    id: 'rainwater_collection',
    name: 'Rainwater Harvesting',
    nameKey: 'amenities.rainwaterCollection',
    icon: RiDropLine,
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
    nameKey: 'amenities.airConditioning',
    icon: RiSnowflakeLine,
    category: 'comfort',
    description: 'Cooling system for health and safety in hot weather',
    maxFairValue: 35, // Reasonable value - becoming essential due to climate change
    ethicalNotes: 'Becoming essential for health and safety due to climate change',
    environmental: 'negative',
  },
  {
    id: 'insulation',
    name: 'Proper Insulation',
    nameKey: 'amenities.insulation',
    icon: RiShieldLine,
    category: 'comfort',
    description: 'Well-insulated for energy efficiency and comfort',
    maxFairValue: 10, // Low value as it should be standard
    ethicalNotes: 'Proper insulation should be standard for energy efficiency',
    environmental: 'positive',
  },
  {
    id: 'ceiling_fans',
    name: 'Ceiling Fans',
    nameKey: 'amenities.ceilingFans',
    icon: RiRefreshLine,
    category: 'comfort',
    description: 'Energy-efficient ceiling fans for air circulation',
    maxFairValue: 10, // Low value for energy-efficient cooling
    ethicalNotes: 'Energy-efficient alternative to air conditioning',
    environmental: 'positive',
  },

  // Kitchen & Dining - Basic appliances for nutrition and health
  {
    id: 'kitchen',
    name: 'Kitchen',
    icon: RiRestaurantLine,
    category: 'kitchen',
    description: 'Full kitchen for preparing meals',
    essential: true,
    maxFairValue: 0,
    ethicalNotes: 'A usable kitchen is essential for nutrition and dignified living',
    environmental: 'neutral',
  },
  {
    id: 'refrigerator',
    name: 'Full-Size Refrigerator',
    nameKey: 'amenities.refrigerator',
    icon: RiSnowflakeLine,
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
    nameKey: 'amenities.stove',
    icon: RiFireLine,
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
    nameKey: 'amenities.oven',
    icon: RiFireLine,
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
    nameKey: 'amenities.microwave',
    icon: RiBroadcastLine,
    category: 'kitchen',
    description: 'Energy-efficient microwave for quick food preparation',
    maxFairValue: 10, // Low value for convenience
    ethicalNotes: 'Convenient and energy-efficient food preparation',
    environmental: 'positive',
  },
  {
    id: 'dishwasher',
    name: 'Dishwasher',
    nameKey: 'amenities.dishwasher',
    icon: RiDropLine,
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
    nameKey: 'amenities.washingMachine',
    icon: RiShoppingBag3Line,
    category: 'essential',
    description: 'Private washing machine in unit',
    maxFairValue: 30, // Reasonable value for privacy and convenience
    ethicalNotes: 'Provides dignity and convenience, especially important for families',
    environmental: 'neutral',
  },
  {
    id: 'dryer',
    name: 'In-Unit Dryer',
    nameKey: 'amenities.dryer',
    icon: RiShoppingBag3Line,
    category: 'essential',
    description: 'Private clothes dryer in unit',
    maxFairValue: 20, // Reasonable value for convenience
    ethicalNotes: 'Complements washing facilities for complete laundry solution',
    environmental: 'neutral',
  },
  {
    id: 'laundry_room',
    name: 'Shared Laundry Facility',
    nameKey: 'amenities.laundryRoom',
    icon: RiBuilding2Line,
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
    nameKey: 'amenities.bikeStorage',
    icon: RiWalkLine,
    category: 'transportation',
    description: 'Safe bicycle storage facility',
    maxFairValue: 10, // Low value to encourage sustainable transport
    ethicalNotes: 'Promotes sustainable transportation and should be affordable',
    environmental: 'positive',
  },
  {
    id: 'parking_space',
    name: 'Parking Space',
    nameKey: 'amenities.parkingSpace',
    icon: RiCarLine,
    category: 'transportation',
    description: 'Assigned parking spot',
    maxFairValue: 40, // Moderate value but should reflect actual cost
    ethicalNotes: 'Should be priced fairly based on actual costs, not inflated',
    environmental: 'negative',
  },
  {
    id: 'ev_charging',
    name: 'Electric Vehicle Charging',
    nameKey: 'amenities.evCharging',
    icon: RiPlugLine,
    category: 'transportation',
    description: 'Electric vehicle charging station access',
    maxFairValue: 30, // Reasonable value for supporting clean transportation
    ethicalNotes: 'Supports transition to clean transportation',
    environmental: 'positive',
  },
  {
    id: 'public_transit_access',
    name: 'Public Transit Access',
    nameKey: 'amenities.publicTransitAccess',
    icon: RiRouteLine,
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
    nameKey: 'amenities.fireSafety',
    icon: RiFireLine,
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
    nameKey: 'amenities.secureEntry',
    icon: RiKey2Line,
    category: 'security',
    description: 'Secure building entry with access control',
    maxFairValue: 15, // Low value as basic security should be standard
    ethicalNotes: 'Basic security should be standard, not a premium feature',
    environmental: 'neutral',
  },
  {
    id: 'security_cameras',
    name: 'Security Cameras',
    nameKey: 'amenities.securityCameras',
    icon: RiVideoLine,
    category: 'security',
    description: 'CCTV surveillance in common areas (with privacy protections)',
    maxFairValue: 20, // Moderate value for security
    ethicalNotes: 'Security cameras should respect privacy and be used ethically',
    environmental: 'neutral',
  },
  {
    id: 'intercom',
    name: 'Intercom System',
    nameKey: 'amenities.intercom',
    icon: RiChat3Line,
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
    nameKey: 'amenities.storageUnit',
    icon: RiBox3Line,
    category: 'storage',
    description: 'Additional storage space',
    maxFairValue: 25, // Reasonable value for extra space
    ethicalNotes: 'Extra storage should be priced fairly based on space provided',
    environmental: 'neutral',
  },
  {
    id: 'attic',
    name: 'Attic',
    nameKey: 'amenities.attic',
    icon: RiBox3Line,
    category: 'storage',
    description: 'Attic storage space',
    maxFairValue: 15,
    ethicalNotes: 'Extra storage should be priced fairly based on space provided',
    environmental: 'neutral',
  },
  {
    id: 'walk_in_closet',
    name: 'Walk-in Closet',
    nameKey: 'amenities.walkInCloset',
    icon: RiShoppingBag3Line,
    category: 'storage',
    description: 'Large walk-in closet space',
    maxFairValue: 20, // Reasonable value for convenience
    ethicalNotes: 'Adequate storage is important for organized living',
    environmental: 'neutral',
  },
  {
    id: 'pantry',
    name: 'Kitchen Pantry',
    nameKey: 'amenities.pantry',
    icon: RiBookOpenLine,
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
    nameKey: 'amenities.communityRoom',
    icon: RiGroupLine,
    category: 'community',
    description: 'Shared community space for residents',
    maxFairValue: 15, // Low value for community building
    ethicalNotes: 'Community spaces promote social connection and mental health',
    environmental: 'positive',
  },
  {
    id: 'gym',
    name: 'Fitness Center',
    nameKey: 'amenities.gym',
    icon: RiHeartPulseLine,
    category: 'wellness',
    description: 'On-site fitness facility',
    maxFairValue: 30, // Moderate value for health benefits
    ethicalNotes: 'Promotes health and wellness in the community',
    environmental: 'positive',
  },
  {
    id: 'playground',
    name: "Children's Playground",
    icon: RiEmotionHappyLine,
    category: 'community',
    description: 'Safe playground area for children',
    maxFairValue: 15, // Low value to support families
    ethicalNotes: 'Essential for families with children - should be affordable',
    environmental: 'positive',
  },
  {
    id: 'garden_space',
    name: 'Community Garden',
    nameKey: 'amenities.gardenSpace',
    icon: RiFlowerLine,
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
    nameKey: 'amenities.fiberInternet',
    icon: RiGlobalLine,
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
    nameKey: 'amenities.cableTv',
    icon: RiMacLine,
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
    nameKey: 'amenities.balcony',
    icon: RiLeafLine,
    category: 'outdoor',
    description: 'Private outdoor balcony space',
    maxFairValue: 25, // Reasonable value for private outdoor space
    ethicalNotes: 'Outdoor space improves mental health and quality of life',
    environmental: 'positive',
  },
  {
    id: 'terrace',
    name: 'Terrace',
    nameKey: 'amenities.terrace',
    icon: RiSunLine,
    category: 'outdoor',
    description: 'Private or shared terrace',
    maxFairValue: 25,
    ethicalNotes: 'Outdoor space improves mental health and quality of life',
    environmental: 'positive',
  },
  {
    id: 'garden_access',
    name: 'Garden Access',
    nameKey: 'amenities.gardenAccess',
    icon: RiFlowerLine,
    category: 'outdoor',
    description: 'Access to shared garden space',
    maxFairValue: 10, // Low value for shared outdoor access
    ethicalNotes: 'Access to nature and outdoor space is important for well-being',
    environmental: 'positive',
  },
  {
    id: 'natural_light',
    name: 'Abundant Natural Light',
    nameKey: 'amenities.naturalLight',
    icon: RiSunLine,
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
    nameKey: 'amenities.petFriendly',
    icon: RiHomeHeartLine,
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
    nameKey: 'amenities.dogPark',
    icon: RiHomeHeartLine,
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
    icon: RiComputerLine,
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
    icon: RiGroupLine,
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
    icon: RiBookOpenLine,
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
    icon: RiHomeLine,
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
    icon: RiPlugLine,
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
    icon: RiVideoLine,
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
    icon: RiDeleteBin6Line,
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
    icon: RiDropLine,
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
    icon: RiSnowflakeLine,
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
    icon: RiRestaurantLine,
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
    icon: RiDropLine,
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
    icon: RiDropLine,
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
    icon: RiDropLine,
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
    icon: RiFireLine,
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
    icon: RiBookOpenLine,
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
    icon: RiRectangleLine,
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
    icon: RiRectangleLine,
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
    icon: RiRectangleLine,
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
    icon: RiLightbulbLine,
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
    icon: RiEqualizerLine,
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
    icon: RiLightbulbLine,
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
    icon: RiLoopRightLine,
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
    icon: RiLeafLine,
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
    icon: RiDropLine,
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
    icon: RiBookOpenLine,
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
    icon: RiShoppingBag3Line,
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
    icon: RiBookOpenLine,
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
    icon: RiFireLine,
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
    icon: RiFireLine,
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
    icon: RiArrowUpCircleLine,
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
    icon: RiDropLine,
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
    icon: RiDropLine,
    category: 'wellness',
    description: 'Relaxing hot tub spa facility',
    descriptionKey: 'amenities.hotTub.description',
    maxFairValue: 25,
    ethicalNotes: 'Wellness amenity for relaxation and community',
    environmental: 'neutral',
  },
  {
    id: 'sauna',
    name: 'Sauna',
    nameKey: 'amenities.sauna',
    icon: RiFireLine,
    category: 'wellness',
    description: 'Private or shared sauna',
    maxFairValue: 25,
    ethicalNotes: 'Wellness amenity for relaxation and community',
    environmental: 'neutral',
  },

  // Family & Children Amenities
  {
    id: 'daycare',
    name: 'On-site Childcare',
    nameKey: 'amenities.daycare',
    icon: RiEmotionHappyLine,
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
    icon: RiGamepadLine,
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
    icon: RiGroupLine,
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
    icon: RiHeartLine,
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
    icon: RiAccessibilityLine,
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
    icon: RiBuilding2Line,
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
    icon: RiPrinterLine,
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
    icon: RiMailLine,
    category: 'essential',
    description: 'Secure package delivery and mail sorting',
    descriptionKey: 'amenities.mailRoom.description',
    essential: true,
    maxFairValue: 5,
    ethicalNotes: 'Secure mail delivery is essential in modern living',
    environmental: 'neutral',
  },
];

/**
 * Ingest canonical amenity slug (from `@homiio/listing-providers`
 * `parse/amenities.ts`) → catalog amenity id. External listings store the
 * fixed canonical vocabulary (`pool`, `parking`, `garden`, …); a few of those
 * keys differ from the catalog id used by internally-created listings
 * (`swimming_pool`, `parking_space`, `garden_space`, …). Resolving through this
 * map means external + internal listings share one icon + one translation.
 * Canonical keys that already match a catalog id (`elevator`, `heating`,
 * `air_conditioning`, `wifi`, `terrace`, `sauna`, `attic`, …) are absent here
 * and pass through unchanged.
 */
const CANONICAL_AMENITY_ALIASES: Readonly<Record<string, string>> = {
  pool: 'swimming_pool',
  parking: 'parking_space',
  garden: 'garden_space',
  storage: 'storage_unit',
  laundry: 'laundry_room',
  washer: 'washing_machine',
  jacuzzi: 'hot_tub',
  armored_door: 'secure_entry',
  disabled_access: 'wheelchair_accessible',
  intercom_system: 'intercom',
};

/** Resolve a stored amenity slug to its catalog id (identity when not aliased). */
const resolveAmenityId = (id: string): string => CANONICAL_AMENITY_ALIASES[id] ?? id;

// Helper functions for ethical amenity management
export const getAmenityById = (id: string): Amenity | undefined => {
  const resolvedId = resolveAmenityId(id);
  return AMENITIES.find((amenity) => amenity.id === resolvedId);
};

/**
 * A resolved amenity entry for display: keeps the raw id (so unknown ids still
 * render with a sensible fallback) alongside its catalog config when found.
 */
export interface ResolvedAmenity {
  id: string;
  amenity?: Amenity;
}

/** A display group of amenities sharing a category, in catalog order. */
export interface AmenityGroup {
  /** Category id (e.g. `kitchen`), or `other` for uncategorized ids. */
  categoryId: string;
  category?: AmenityCategory;
  amenities: ResolvedAmenity[];
}

/** Synthetic category id used for amenities with no known catalog category. */
export const UNCATEGORIZED_AMENITY_ID = 'other';

/**
 * Group a list of amenity ids into display groups by category, ordered to match
 * {@link AMENITY_CATEGORIES}. Within each group, amenities preserve the input
 * order. Ids with no resolvable category (unknown ids, or catalog entries whose
 * category isn't in {@link AMENITY_CATEGORIES}) fall into a trailing `other`
 * group so nothing is silently dropped.
 *
 * Used by the property-detail "What this place offers" sheet to render Airbnb-
 * style category subheadings.
 */
export const groupAmenitiesByCategory = (ids: string[]): AmenityGroup[] => {
  const byCategory = new Map<string, ResolvedAmenity[]>();

  for (const id of ids) {
    const resolvedId = resolveAmenityId(id);
    const amenity = getAmenityById(resolvedId);
    const categoryId =
      amenity && getCategoryById(amenity.category) ? amenity.category : UNCATEGORIZED_AMENITY_ID;
    const bucket = byCategory.get(categoryId);
    if (bucket) {
      bucket.push({ id: resolvedId, amenity });
    } else {
      byCategory.set(categoryId, [{ id: resolvedId, amenity }]);
    }
  }

  const groups: AmenityGroup[] = [];

  for (const category of AMENITY_CATEGORIES) {
    const amenities = byCategory.get(category.id);
    if (amenities && amenities.length > 0) {
      groups.push({ categoryId: category.id, category, amenities });
    }
  }

  const other = byCategory.get(UNCATEGORIZED_AMENITY_ID);
  if (other && other.length > 0) {
    groups.push({ categoryId: UNCATEGORIZED_AMENITY_ID, amenities: other });
  }

  return groups;
};

const getCategoryById = (id: string): AmenityCategory | undefined => {
  return AMENITY_CATEGORIES.find((category) => category.id === id);
};

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
