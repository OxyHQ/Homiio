/**
 * Telegram Service
 * Handles Telegram bot operations and property notifications
 */

import TelegramBot from 'node-telegram-bot-api';
import i18n from 'i18n';
import path from 'path';
import config from '../config';
import { logger } from '../middlewares/logging';

// Configure i18n
i18n.configure({
  locales: ['en', 'es'],
  defaultLocale: 'es', // Spanish as default
  directory: path.join(__dirname, '..', 'locales'),
  objectNotation: true,
  updateFiles: false
});

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
      logger.error('Failed to initialize Telegram bot:', error);
      this.isInitialized = false;
    }
  }

  /**
   * Get the appropriate Telegram group for notifications
   * For now, returns the default group for all cities
   * @param {string} city - The city name (for future expansion)
   * @returns {Object} - Group configuration with id and language
   */
  getGroupForCity(city) {
    // For now, all notifications go to the default Spanish group
    // In the future, this can be expanded to route based on city/region
    return config.telegram.defaultGroup;
  }

  /**
   * Get translations for a specific language
   * @param {string} language - Language code (es, en)
   * @returns {Object} - Configured i18n instance for the language
   */
  getI18nForLanguage(language = 'es') {
    const i18nInstance = Object.create(i18n);
    i18nInstance.setLocale(language);
    return i18nInstance;
  }

  /**
   * Escape Markdown characters to prevent parsing errors
   * @param {string} text - Text to escape
   * @returns {string} - Escaped text
   */
  escapeMarkdown(text) {
    if (!text) return '';
    // Escape special Markdown characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
    return text.replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Get the best image for a property
   * @param {Object} property - The property object
   * @returns {string} - Image URL (always returns a valid URL)
   */
  getPropertyImage(property) {
    // Check if property has valid images array
    if (!property.images || !Array.isArray(property.images) || property.images.length === 0) {
      logger.info('No images found for property, using default placeholder', {
        propertyId: property._id
      });
      return 'https://homiio.com/images/property-placeholder.jpg';
    }

    // Find primary image first
    const primaryImage = property.images.find(img => img.isPrimary);
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
  formatPropertyMessage(property, language = 'es') {
    const {
      type,
      bedrooms,
      bathrooms,
      rent,
      address,
      description,
      amenities,
      availability,
      _id
    } = property;

    // Get translations for the language
    const t = this.getI18nForLanguage(language);

    // Create dynamic title: "{PropertyType} for rent in {Street}, {City}, {State}"
    const propertyType = t.__(`telegram.propertyTypes.${type}`) || type;
    const forRentText = t.__('telegram.forRent');
    
    // Helper function to remove property numbers for privacy
    const removePropertyNumber = (street) => {
      if (!street) return '';
      // Remove numbers, commas and extra spaces from street for privacy
      // Examples: "Calle de Vicente Blasco Ibáñez, 6" -> "Calle de Vicente Blasco Ibáñez"
      return street.replace(/,?\s*\d+.*$/, '').trim();
    };
    
    // Build location string (without property numbers for privacy)
    let location = '';
    if (address.street && address.city) {
      const streetWithoutNumber = removePropertyNumber(address.street);
      location = `${streetWithoutNumber}, ${address.city}`;
      if (address.state) {
        location += `, ${address.state}`;
      }
    } else if (address.city) {
      location = address.city;
      if (address.state) {
        location += `, ${address.state}`;
      }
    } else {
      location = address.state || t.__('telegram.locationNotSpecified');
    }
    
    const dynamicTitle = `🏠 **${this.escapeMarkdown(propertyType)} ${this.escapeMarkdown(forRentText)} ${this.escapeMarkdown(location)}**`;
    
    // Format rent
    const paymentFreq = t.__(`telegram.paymentFrequency.${rent.paymentFrequency}`) || rent.paymentFrequency;
    const rentDisplay = `${rent.currency} ${rent.amount.toLocaleString()}/${paymentFreq}`;
    
    // Format amenities (limit to first 5)
    const amenitiesText = amenities && amenities.length > 0 
      ? amenities.slice(0, 5).join(', ') + (amenities.length > 5 ? '...' : '')
      : t.__('telegram.noneListedAmenities');

    // Available date
    const availableDate = availability.availableFrom 
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

    const message = `${dynamicTitle}

💰 **${t.__('telegram.rent')}:** ${this.escapeMarkdown(rentDisplay)}
📅 **${t.__('telegram.available')}:** ${this.escapeMarkdown(availableDate)}

🏡 **${t.__('telegram.details')}:**
• ${bedrooms} ${t.__('telegram.bedrooms')}, ${bathrooms} ${t.__('telegram.bathrooms')}
• ${this.escapeMarkdown(removePropertyNumber(address.street))}, ${this.escapeMarkdown(address.city)}, ${this.escapeMarkdown(address.state)} ${this.escapeMarkdown(address.zipCode)}
• ${t.__('telegram.type')}: ${this.escapeMarkdown(propertyType)}
${property.squareFootage ? `• ${t.__('telegram.size')}: ${this.escapeMarkdown(property.squareFootage.toString())} m²` : ''}

✨ **${t.__('telegram.amenities')}:** ${this.escapeMarkdown(amenitiesText)}${descriptionSection}
${t.__('telegram.hashtags.newProperty')} #${this.escapeMarkdown(address.city.replace(/\s+/g, ''))} #${this.escapeMarkdown(propertyType.replace(/\s+/g, ''))}`;

    return message;
  }

  /**
   * Send property notification to appropriate Telegram group
   * @param {Object} property - The property object
   * @returns {Promise<boolean>} - Success status
   */
  async sendPropertyNotification(property) {
    try {
      if (!this.isInitialized) {
        logger.warn('Telegram bot not initialized. Skipping notification.');
        return false;
      }

      // Get the group configuration
      const groupConfig = this.getGroupForCity(property.address?.city);
      
      if (!groupConfig || !groupConfig.id) {
        logger.warn('No Telegram group configured. Skipping notification.', {
          city: property.address?.city,
          propertyId: property._id
        });
        return false;
      }

      // Format message with appropriate language
      const message = this.formatPropertyMessage(property, groupConfig.language);
      
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
      
      try {
        // Send photo with caption instead of text message
        await this.bot.sendPhoto(groupConfig.id, imageUrl, {
          caption: message,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });

        logger.info('Property notification sent to Telegram group with image', {
          propertyId: property._id,
          city: property.address?.city,
          groupId: groupConfig.id,
          language: groupConfig.language,
          imageUrl: imageUrl
        });
      } catch (imageError) {
        // If image sending fails, fall back to text message
        logger.warn('Failed to send image, falling back to text message', {
          propertyId: property._id,
          imageUrl: imageUrl,
          error: imageError.message
        });

        await this.bot.sendMessage(groupConfig.id, message, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
          reply_markup: keyboard
        });

        logger.info('Property notification sent to Telegram group as text message (fallback)', {
          propertyId: property._id,
          city: property.address?.city,
          groupId: groupConfig.id,
          language: groupConfig.language
        });
      }

      return true;
    } catch (error) {
      logger.error('Failed to send Telegram notification:', {
        error: error.message,
        propertyId: property._id,
        city: property.address?.city
      });
      return false;
    }
  }

  /**
   * Send a test message to verify bot configuration
   * @param {string} groupId - The group ID to test
   * @param {string} message - Optional custom message
   * @param {boolean} includeButton - Whether to include a test button
   * @returns {Promise<boolean>} - Success status
   */
  async sendTestMessage(groupId, message = null, includeButton = true) {
    try {
      if (!this.isInitialized) {
        throw new Error('Telegram bot not initialized');
      }

      // Get language for this group (default to Spanish)
      const groupConfig = config.telegram.groups[groupId];
      const language = groupConfig?.language || 'es';
      const t = this.getI18nForLanguage(language);

      // Use provided message or default translated message
      const finalMessage = message || t.__('telegram.testMessage');

      const options: any = {
        parse_mode: 'Markdown'
      };

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
      logger.info('Test message sent successfully', { groupId, language, includeButton });
      return true;
    } catch (error) {
      logger.error('Failed to send test message:', {
        error: error.message,
        groupId
      });
      return false;
    }
  }

  /**
   * Get bot information
   * @returns {Promise<Object>} - Bot information
   */
  async getBotInfo() {
    try {
      if (!this.isInitialized) {
        throw new Error('Telegram bot not initialized');
      }

      const botInfo = await this.bot.getMe();
      return botInfo;
    } catch (error) {
      logger.error('Failed to get bot info:', error);
      throw error;
    }
  }

  /**
   * Send bulk notifications for multiple properties
   * @param {Array} properties - Array of property objects
   * @returns {Promise<Object>} - Results summary
   */
  async sendBulkNotifications(properties) {
    const results = {
      total: properties.length,
      successful: 0,
      failed: 0,
      errors: []
    };

    for (const property of properties) {
      try {
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
          error: error.message
        });
      }
    }

    logger.info('Bulk notifications completed', results);
    return results;
  }

  /**
   * Get configured groups summary
   * @returns {Object} - Groups configuration summary
   */
  getGroupsSummary() {
    const summary = {
      defaultGroup: config.telegram.defaultGroup,
      groups: {},
      totalGroups: 0,
      configuredGroups: 0
    };

    // Process configured groups
    if (config.telegram.groups) {
      for (const [groupId, groupConfig] of Object.entries(config.telegram.groups)) {
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
  testPropertyImageFunctionality(testProperty = null) {
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
}

// Create singleton instance
const telegramService = new TelegramService();

export default telegramService;