/**
 * Telegram Service
 * Handles Telegram bot operations and property notifications
 */

import TelegramBot from 'node-telegram-bot-api';
import i18n from 'i18n';
import path from 'path';
import config from '../config';
import { logger } from '../middlewares/logging';
import { generateLargePropertyTitle } from '../utils/propertyTitleGenerator';
import { resolveAddressDisplay, type GeoDisplay, type AddressGeoLike } from './geoDisplayService';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

interface PropertyImageLike {
  url?: string | null;
  isPrimary?: boolean;
}

interface PropertyAddressLike extends AddressGeoLike {
  street?: string;
  postal_code?: string;
  city?: string;
  country?: string;
}

interface PropertyLike {
  _id?: unknown;
  type?: string;
  bedrooms?: number;
  bathrooms?: number;
  longTermRent?: { monthlyAmount?: number; currency?: string };
  shortTermRent?: { nightlyRate?: number; currency?: string };
  sale?: { price?: number; currency?: string };
  address?: PropertyAddressLike;
  description?: string;
  amenities?: string[];
  availability?: { availableFrom?: Date | string };
  images?: PropertyImageLike[];
  squareFootage?: number;
}

interface GroupConfig {
  id?: string | number;
  language?: string;
}

interface BulkNotificationResults {
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  errors: Array<{ propertyId: unknown; error: string }>;
}

interface GroupsSummary {
  defaultGroup: GroupConfig | undefined;
  groups: Record<string, GroupConfig & { configured: boolean }>;
  totalGroups: number;
  configuredGroups: number;
  supportedLocations: string[];
  topicMappings: Record<string, number>;
}

// Configure i18n
i18n.configure({
  locales: ['en', 'es'],
  defaultLocale: 'es', // Spanish as default
  directory: path.join(__dirname, '..', 'locales'),
  objectNotation: true,
  updateFiles: false
});

// City-Country to Topic ID mapping
const CITY_TOPIC_MAPPING: Record<string, number> = {
  'New York, US': 4,
  'New York, United States': 4, // Handle both US and United States
  'Barcelona, Spain': 2,
  // Add more mappings as needed
  // Format: 'City, Country': topicId
};

class TelegramService {
  private bot: TelegramBot | null;
  private isInitialized: boolean;

  constructor() {
    this.bot = null;
    this.isInitialized = false;
    this.initialize();
  }

  /**
   * Initialize the Telegram bot
   */
  initialize() {
    try {
      if (!config.telegram.enabled) {
        logger.info('Telegram notifications are disabled');
        return;
      }

      if (!config.telegram.botToken) {
        logger.warn('Telegram bot token not provided. Telegram notifications will be disabled.');
        return;
      }

      // Initialize bot with polling disabled for production
      const options = {
        polling: false, // We don't need polling since we're just sending messages
      };

      this.bot = new TelegramBot(config.telegram.botToken, options);
      this.isInitialized = true;
      
      logger.info('Telegram bot initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Telegram bot:', { error: errorMessage(error) });
      this.isInitialized = false;
    }
  }

  /**
   * Get the appropriate Telegram group for notifications
   * For now, returns the default group for all cities
   * @param {string} city - The city name (for future expansion)
   * @returns {Object} - Group configuration with id and language
   */
  getGroupForCity(_city: string | null | undefined): GroupConfig | undefined {
    // For now, all notifications go to the default Spanish group
    // In the future, this can be expanded to route based on city/region
    return config.telegram.defaultGroup;
  }

  /**
   * Get topic ID for city and country combination
   * @param {string} city - The city name
   * @param {string} country - The country name
   * @returns {number|null} - Topic ID if found, null otherwise
   */
  getTopicIdForLocation(city: string | null | undefined, country: string | null | undefined): number | null {
    if (!city || !country) {
      return null;
    }

    const locationKey = `${city}, ${country}`;
    return CITY_TOPIC_MAPPING[locationKey] ?? null;
  }

  /**
   * Check if a location is supported for Telegram notifications
   * @param {string} city - The city name
   * @param {string} country - The country name
   * @returns {boolean} - True if location is supported
   */
  isLocationSupported(city: string | null | undefined, country: string | null | undefined): boolean {
    return this.getTopicIdForLocation(city, country) !== null;
  }

  /**
   * Get translations for a specific language
   * @param {string} language - Language code (es, en)
   * @returns {Object} - Configured i18n instance for the language
   */
  getI18nForLanguage(language: string = 'es'): typeof i18n {
    const i18nInstance: typeof i18n = Object.create(i18n);
    i18nInstance.setLocale(language);
    return i18nInstance;
  }

  /**
   * Escape Markdown characters to prevent parsing errors
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeMarkdown(text: string | null | undefined): string {
    if (!text) return '';
    // Escape special Markdown characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Get the best image for a property
   * @param {Object} property - The property object
   * @returns {string} - Image URL (always returns a valid URL)
   */
  getPropertyImage(property: PropertyLike): string {
    // Check if property has valid images array
    if (!property.images || !Array.isArray(property.images) || property.images.length === 0) {
      logger.info('No images found for property, using default placeholder', {
        propertyId: property._id
      });
      return 'https://homiio.com/images/property-placeholder.jpg';
    }

    // Find primary image first
    const primaryImage = property.images.find((img: PropertyImageLike) => img.isPrimary);
    if (primaryImage && primaryImage.url) {
      logger.debug('Using primary image for property', {
        propertyId: property._id,
        imageUrl: primaryImage.url
      });
      return primaryImage.url;
    }

    // Fall back to first image
    const firstImage = property.images[0];
    if (firstImage && firstImage.url) {
      logger.debug('Using first image for property', {
        propertyId: property._id,
        imageUrl: firstImage.url
      });
      return firstImage.url;
    }

    // If no valid images found, return default
    logger.warn('No valid image URLs found for property, using default placeholder', {
      propertyId: property._id,
      imageCount: property.images.length
    });
    return 'https://homiio.com/images/property-placeholder.jpg';
  }

  /**
   * Format property information for Telegram message
   * @param {Object} property - The property object
   * @param {string} language - Language code for translations
   * @returns {string} - Formatted message
   */
  formatPropertyMessage(property: PropertyLike, language: string = 'es', geo: GeoDisplay | null = null): string {
    const {
      type,
      bedrooms,
      bathrooms,
      longTermRent,
      shortTermRent,
      sale,
      address,
      description,
      amenities,
      availability,
      _id
    } = property;

    // Get translations for the language
    const t = this.getI18nForLanguage(language);

    // Generate large format title using the title generator. Geo labels are
    // relational and threaded through explicitly (resolved by the caller).
    const largeTitle = generateLargePropertyTitle({
      type,
      address,
      bedrooms,
      bathrooms,
      geo: geo
        ? {
            city: geo.city ?? undefined,
            region: geo.region ?? undefined,
            neighborhood: geo.neighborhood ?? undefined
          }
        : null
    });

    const dynamicTitle = `🏠 **${this.escapeMarkdown(largeTitle)}**`;

    // Format price from the listing's primary offering block (monthly rent →
    // nightly rate → sale price). Falls back to a neutral label when none set.
    let rentDisplay = t.__('telegram.priceOnRequest') || 'Price on request';
    if (longTermRent?.monthlyAmount) {
      const perMonth = t.__('telegram.perMonth') || 'month';
      rentDisplay = `${longTermRent.currency} ${Number(longTermRent.monthlyAmount).toLocaleString()}/${perMonth}`;
    } else if (shortTermRent?.nightlyRate) {
      const perNight = t.__('telegram.perNight') || 'night';
      rentDisplay = `${shortTermRent.currency} ${Number(shortTermRent.nightlyRate).toLocaleString()}/${perNight}`;
    } else if (sale?.price) {
      rentDisplay = `${sale.currency} ${Number(sale.price).toLocaleString()}`;
    }
    
    // Format amenities (limit to first 5)
    const amenitiesText = amenities && amenities.length > 0 
      ? amenities.slice(0, 5).join(', ') + (amenities.length > 5 ? '...' : '')
      : t.__('telegram.noneListedAmenities');

    // Available date
    const availableDate = availability?.availableFrom
      ? new Date(availability.availableFrom).toLocaleDateString(language === 'es' ? 'es-ES' : 'en-US')
      : t.__('telegram.immediately');

    // Build description section only if description exists
    let descriptionSection = '';
    if (description && description.trim()) {
      const truncatedDescription = description.length > 200 
        ? description.substring(0, 200) + '...' 
        : description;
      descriptionSection = `\n📝 **${t.__('telegram.description')}:**\n${this.escapeMarkdown(truncatedDescription)}\n`;
    }

    // Get property type for hashtags and details
    const propertyType: string = t.__(`telegram.propertyTypes.${type}`) || type || '';
    
    // Helper function to remove property numbers for privacy (used in details)
    const removePropertyNumber = (street: string | undefined): string => {
      if (!street) return '';
      return street.replace(/,?\s*\d+.*$/, '').trim();
    };

    // City/region labels are relational (resolved from the canonical geo docs);
    // only the building-level street + postal code come off the address.
    const cityLabel = (geo && geo.city) || '';
    const regionLabel = (geo && geo.region) || '';
    const postalCode = address?.postal_code || '';
    const locationLine = [removePropertyNumber(address?.street), cityLabel, `${regionLabel} ${postalCode}`.trim()]
      .filter((part): part is string => Boolean(part))
      .map((part: string) => this.escapeMarkdown(part))
      .join(', ');
    const cityHashtag = cityLabel ? ` #${this.escapeMarkdown(cityLabel.replace(/\s+/g, ''))}` : '';

    const message = `${dynamicTitle}

💰 **${t.__('telegram.rent')}:** ${this.escapeMarkdown(rentDisplay)}
📅 **${t.__('telegram.available')}:** ${this.escapeMarkdown(availableDate)}

🏡 **${t.__('telegram.details')}:**
• ${bedrooms} ${t.__('telegram.bedrooms')}, ${bathrooms} ${t.__('telegram.bathrooms')}
• ${locationLine}
• ${t.__('telegram.type')}: ${this.escapeMarkdown(propertyType)}
${property.squareFootage ? `• ${t.__('telegram.size')}: ${this.escapeMarkdown(property.squareFootage.toString())} m²` : ''}

✨ **${t.__('telegram.amenities')}:** ${this.escapeMarkdown(amenitiesText)}${descriptionSection}
${t.__('telegram.hashtags.newProperty')}${cityHashtag} #${this.escapeMarkdown(propertyType.replace(/\s+/g, ''))}`;

    return message;
  }

  /**
   * Send property notification to appropriate Telegram group with topic support
   * @param {Object} property - The property object
   * @returns {Promise<boolean>} - Success status
   */
  async sendPropertyNotification(property: PropertyLike): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.bot) {
        logger.warn('Telegram bot not initialized. Skipping notification.');
        return false;
      }

      // Geo is relational: resolve the city/region/country display names from the
      // canonical geo docs (populated or by id) before deciding routing/format.
      const geo = await resolveAddressDisplay(property.address);
      const city = geo.city;
      const country = geo.country;

      if (!this.isLocationSupported(city, country)) {
        logger.info('Location not supported for Telegram notifications. Skipping notification.', {
          city,
          country,
          propertyId: property._id
        });
        return false;
      }

      // Get topic ID for this location
      const topicId = this.getTopicIdForLocation(city, country);

      // Get the group configuration
      const groupConfig = this.getGroupForCity(city);

      if (!groupConfig || !groupConfig.id) {
        logger.warn('No Telegram group configured. Skipping notification.', {
          city,
          country,
          propertyId: property._id
        });
        return false;
      }

      // Format message with appropriate language
      const message = this.formatPropertyMessage(property, groupConfig.language, geo);
      
      // Get translations for button text
      const t = this.getI18nForLanguage(groupConfig.language);
      
      // Create inline keyboard with link to property
      const keyboard = {
        inline_keyboard: [
          [
            {
              text: t.__('telegram.viewPropertyDetails'),
              url: `https://homiio.com/properties/${property._id}`
            }
          ]
        ]
      };

      // Get the best image for the property
      const imageUrl = this.getPropertyImage(property);
      
      // Prepare message options with topic support
      const messageOptions: TelegramBot.SendPhotoOptions = {
        caption: message,
        parse_mode: 'Markdown',
        reply_markup: keyboard
      };

      // Add topic ID if available
      if (topicId) {
        messageOptions.message_thread_id = topicId;
      }
      
      try {
        // Send photo with caption instead of text message
        await this.bot.sendPhoto(groupConfig.id, imageUrl, messageOptions);

        logger.info('Property notification sent to Telegram group with image and topic', {
          propertyId: property._id,
          city,
          country,
          topicId,
          groupId: groupConfig.id,
          language: groupConfig.language,
          imageUrl: imageUrl
        });
      } catch (imageError) {
        // If image sending fails, fall back to text message
        logger.warn('Failed to send image, falling back to text message', {
          propertyId: property._id,
          imageUrl: imageUrl,
          error: errorMessage(imageError)
        });

        const textMessageOptions: TelegramBot.SendMessageOptions = {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: keyboard
        };

        // Add topic ID for text message as well
        if (topicId) {
          textMessageOptions.message_thread_id = topicId;
        }

        await this.bot.sendMessage(groupConfig.id, message, textMessageOptions);

        logger.info('Property notification sent to Telegram group as text message (fallback) with topic', {
          propertyId: property._id,
          city,
          country,
          topicId,
          groupId: groupConfig.id,
          language: groupConfig.language
        });
      }

      return true;
    } catch (error) {
      logger.error('Failed to send Telegram notification:', {
        error: errorMessage(error),
        propertyId: property._id,
        city: property.address?.city,
        country: property.address?.country
      });
      return false;
    }
  }

  /**
   * Send a test message to verify bot configuration
   * @param {string} groupId - The group ID to test
   * @param {string} message - Optional custom message
   * @param {boolean} includeButton - Whether to include a test button
   * @param {number} topicId - Optional topic ID for forum threads
   * @returns {Promise<boolean>} - Success status
   */
  async sendTestMessage(
    groupId: string | number,
    message: string | null = null,
    includeButton: boolean = true,
    topicId: number | null = null
  ): Promise<boolean> {
    try {
      if (!this.isInitialized || !this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      // Get language for this group (default to Spanish)
      const groups = config.telegram.groups as Record<string, GroupConfig> | undefined;
      const groupConfig = groups?.[String(groupId)];
      const language = groupConfig?.language || 'es';
      const t = this.getI18nForLanguage(language);

      // Use provided message or default translated message
      const finalMessage = message || t.__('telegram.testMessage');

      const options: TelegramBot.SendMessageOptions = {
        parse_mode: 'Markdown'
      };

      // Add topic ID if provided
      if (topicId) {
        options.message_thread_id = topicId;
      }

      // Add test button if requested
      if (includeButton) {
        options.reply_markup = {
          inline_keyboard: [
            [
              {
                text: t.__('telegram.visitHomiio'),
                url: 'https://homiio.com'
              }
            ]
          ]
        };
      }

      await this.bot.sendMessage(groupId, finalMessage, options);
      logger.info('Test message sent successfully', { groupId, language, includeButton, topicId });
      return true;
    } catch (error) {
      logger.error('Failed to send test message:', {
        error: errorMessage(error),
        groupId,
        topicId
      });
      return false;
    }
  }

  /**
   * Get bot information
   * @returns {Promise<Object>} - Bot information
   */
  async getBotInfo(): Promise<TelegramBot.User> {
    try {
      if (!this.isInitialized || !this.bot) {
        throw new Error('Telegram bot not initialized');
      }

      const botInfo = await this.bot.getMe();
      return botInfo;
    } catch (error) {
      logger.error('Failed to get bot info:', { error: errorMessage(error) });
      throw error;
    }
  }

  /**
   * Send bulk notifications for multiple properties
   * @param {Array} properties - Array of property objects
   * @returns {Promise<Object>} - Results summary
   */
  async sendBulkNotifications(properties: PropertyLike[]): Promise<BulkNotificationResults> {
    const results: BulkNotificationResults = {
      total: properties.length,
      successful: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    for (const property of properties) {
      try {
        // Resolve the relational geo labels to decide routing/support.
        const geo = await resolveAddressDisplay(property.address);
        const city = geo.city;
        const country = geo.country;

        if (!this.isLocationSupported(city, country)) {
          results.skipped++;
          logger.info('Skipping property - location not supported for Telegram notifications', {
            propertyId: property._id,
            city,
            country
          });
          continue;
        }

        const success = await this.sendPropertyNotification(property);
        if (success) {
          results.successful++;
        } else {
          results.failed++;
        }
        
        // Add delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        results.failed++;
        results.errors.push({
          propertyId: property._id,
          error: errorMessage(error)
        });
      }
    }

    logger.info('Bulk notifications completed', { ...results });
    return results;
  }

  /**
   * Get configured groups summary
   * @returns {Object} - Groups configuration summary
   */
  getGroupsSummary(): GroupsSummary {
    const summary: GroupsSummary = {
      defaultGroup: config.telegram.defaultGroup,
      groups: {},
      totalGroups: 0,
      configuredGroups: 0,
      supportedLocations: Object.keys(CITY_TOPIC_MAPPING),
      topicMappings: CITY_TOPIC_MAPPING
    };

    // Process configured groups
    if (config.telegram.groups) {
      const groupsRecord = config.telegram.groups as Record<string, GroupConfig>;
      for (const [groupId, groupConfig] of Object.entries(groupsRecord)) {
        if (groupId && groupId !== 'undefined' && groupId !== 'null') {
          summary.groups[groupId] = {
            ...groupConfig,
            configured: true
          };
          summary.configuredGroups++;
        }
        summary.totalGroups++;
      }
    }

    return summary;
  }

  /**
   * Test property image functionality
   * @param {Object} testProperty - Test property object
   * @returns {Object} - Test results
   */
  testPropertyImageFunctionality(_testProperty: PropertyLike | null = null): {
    success: boolean;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    results: Array<{ name: string; expected: string; actual: string; passed: boolean }>;
  } {
    const testCases = [
      {
        name: 'Property with no images',
        property: {
          _id: 'test-no-images',
          type: 'apartment',
          address: { city: 'Barcelona', state: 'Catalunya' },
          rent: { amount: 1200, currency: 'EUR', paymentFrequency: 'monthly' },
          bedrooms: 2,
          bathrooms: 1
        },
        expectedResult: 'https://homiio.com/images/property-placeholder.jpg'
      },
      {
        name: 'Property with primary image',
        property: {
          _id: 'test-primary-image',
          type: 'house',
          address: { city: 'Madrid', state: 'Madrid' },
          rent: { amount: 1500, currency: 'EUR', paymentFrequency: 'monthly' },
          bedrooms: 3,
          bathrooms: 2,
          images: [
            { url: 'https://example.com/image1.jpg', isPrimary: false },
            { url: 'https://example.com/image2.jpg', isPrimary: true },
            { url: 'https://example.com/image3.jpg', isPrimary: false }
          ]
        },
        expectedResult: 'https://example.com/image2.jpg'
      },
      {
        name: 'Property with images but no primary',
        property: {
          _id: 'test-no-primary',
          type: 'studio',
          address: { city: 'Valencia', state: 'Valencia' },
          rent: { amount: 800, currency: 'EUR', paymentFrequency: 'monthly' },
          bedrooms: 0,
          bathrooms: 1,
          images: [
            { url: 'https://example.com/image1.jpg', isPrimary: false },
            { url: 'https://example.com/image2.jpg', isPrimary: false }
          ]
        },
        expectedResult: 'https://example.com/image1.jpg'
      },
      {
        name: 'Property with invalid image URLs',
        property: {
          _id: 'test-invalid-urls',
          type: 'room',
          address: { city: 'Seville', state: 'Andalucia' },
          rent: { amount: 600, currency: 'EUR', paymentFrequency: 'monthly' },
          bedrooms: 0,
          bathrooms: 1,
          images: [
            { url: '', isPrimary: false },
            { url: null, isPrimary: true },
            { url: undefined, isPrimary: false }
          ]
        },
        expectedResult: 'https://homiio.com/images/property-placeholder.jpg'
      }
    ];

    const results = testCases.map(testCase => {
      const actualResult = this.getPropertyImage(testCase.property);
      const passed = actualResult === testCase.expectedResult;
      
      return {
        name: testCase.name,
        expected: testCase.expectedResult,
        actual: actualResult,
        passed
      };
    });

    const allPassed = results.every(result => result.passed);

    return {
      success: allPassed,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    };
  }

  /**
   * Test location support functionality
   * @returns {Object} - Test results
   */
  testLocationSupport() {
    const testCases = [
      {
        name: 'New York, US - should be supported',
        city: 'New York',
        country: 'US',
        expectedSupported: true,
        expectedTopicId: 4
      },
      {
        name: 'Barcelona, Spain - should be supported',
        city: 'Barcelona',
        country: 'Spain',
        expectedSupported: true,
        expectedTopicId: 2
      },
      {
        name: 'Madrid, Spain - should not be supported',
        city: 'Madrid',
        country: 'Spain',
        expectedSupported: false,
        expectedTopicId: null
      },
      {
        name: 'London, UK - should not be supported',
        city: 'London',
        country: 'UK',
        expectedSupported: false,
        expectedTopicId: null
      },
      {
        name: 'Empty city - should not be supported',
        city: '',
        country: 'US',
        expectedSupported: false,
        expectedTopicId: null
      },
      {
        name: 'Empty country - should not be supported',
        city: 'New York',
        country: '',
        expectedSupported: false,
        expectedTopicId: null
      }
    ];

    const results = testCases.map(testCase => {
      const actualSupported = this.isLocationSupported(testCase.city, testCase.country);
      const actualTopicId = this.getTopicIdForLocation(testCase.city, testCase.country);
      
      const supportedPassed = actualSupported === testCase.expectedSupported;
      const topicIdPassed = actualTopicId === testCase.expectedTopicId;
      
      return {
        name: testCase.name,
        city: testCase.city,
        country: testCase.country,
        expectedSupported: testCase.expectedSupported,
        actualSupported: actualSupported,
        supportedPassed,
        expectedTopicId: testCase.expectedTopicId,
        actualTopicId: actualTopicId,
        topicIdPassed,
        passed: supportedPassed && topicIdPassed
      };
    });

    const allPassed = results.every(result => result.passed);

    return {
      success: allPassed,
      totalTests: results.length,
      passedTests: results.filter(r => r.passed).length,
      failedTests: results.filter(r => !r.passed).length,
      results
    };
  }
}

// Create singleton instance
const telegramService = new TelegramService();

export default telegramService;