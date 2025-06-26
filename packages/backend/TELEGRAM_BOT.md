# Telegram Bot Integration

This document describes the Telegram bot integration that automatically sends property notifications to different Telegram groups based on property location/zone.

## Overview

The Telegram bot system provides:
- Automatic notifications when new properties are created
- **Multi-language support** (Spanish and English) using i18n
- **Dynamic descriptive titles** for each property
- **Privacy protection** (property numbers automatically removed)
- Zone-based routing to different Telegram groups
- Manual notification triggers
- Bulk notification capabilities
- Bot management and testing tools

## Setup Instructions

### 1. Create a Telegram Bot

1. Open Telegram and search for `@BotFather`
2. Start a conversation and use `/newbot` command
3. Follow the instructions to create your bot
4. Save the bot token (you'll need it for configuration)

### 2. Create Telegram Groups

Create Telegram groups for different zones/cities where you want to send property notifications:
- Create groups for each city/zone you want to support
- Add your bot to each group as an administrator
- Get the group IDs (see "Getting Group IDs" section below)

### 3. Environment Configuration

Add the following environment variables to your `.env` file:

```env
# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_NOTIFICATIONS_ENABLED=true

# Default Group (Spanish)
TELEGRAM_GROUP_DEFAULT=-1002750613848

# Additional groups (for future expansion)
# TELEGRAM_GROUP_US=-1001234567890
# TELEGRAM_GROUP_UK=-1001234567891
```

### 4. Language Configuration

Each group is configured with a specific language in `config.js`:

```javascript
groups: {
  // Spanish group (default)
  [process.env.TELEGRAM_GROUP_DEFAULT]: { 
    language: 'es', 
    name: 'Homiio España' 
  },
  // Future English group
  // [process.env.TELEGRAM_GROUP_US]: { 
  //   language: 'en', 
  //   name: 'Homiio US' 
  // }
}
```

**Supported Languages:**
- **Spanish (es)**: Default language with full translations
- **English (en)**: Available for future groups

### 5. Getting Group IDs

To get Telegram group IDs:

**Method 1: Using @userinfobot**
1. Add `@userinfobot` to your group
2. The bot will send the group ID
3. Remove the bot from the group

**Method 2: Using Telegram API**
1. Send a message to your group
2. Visit: `https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates`
3. Look for the `chat.id` field in the response

**Method 3: Using the built-in test endpoint**
1. Start your server with the bot configured
2. Send a test message to any group with your bot
3. Check the server logs for group ID information

## Configuration

### City-to-Group Mapping

The system maps cities to Telegram groups based on the configuration in `config.js`. You can customize the mappings:

```javascript
groupMappings: {
  // Example mappings - configure based on your needs
  'new-york': process.env.TELEGRAM_GROUP_NEW_YORK,
  'brooklyn': process.env.TELEGRAM_GROUP_NEW_YORK,
  'manhattan': process.env.TELEGRAM_GROUP_NEW_YORK,
  'queens': process.env.TELEGRAM_GROUP_NEW_YORK,
  'los-angeles': process.env.TELEGRAM_GROUP_LA,
  'hollywood': process.env.TELEGRAM_GROUP_LA,
  'chicago': process.env.TELEGRAM_GROUP_CHICAGO,
  'miami': process.env.TELEGRAM_GROUP_MIAMI,
  'san-francisco': process.env.TELEGRAM_GROUP_SF,
  'oakland': process.env.TELEGRAM_GROUP_SF,
  // Default group for unmapped cities
  'default': process.env.TELEGRAM_GROUP_DEFAULT
}
```

### City Matching Logic

The system uses the following logic to match cities to groups:

1. **Exact Match**: Direct mapping of normalized city name
2. **Partial Match**: Checks if the city contains any mapped city name
3. **Default Group**: Falls back to default group if no match is found

City names are normalized by:
- Converting to lowercase
- Replacing spaces with hyphens
- Example: "New York" becomes "new-york"

## API Endpoints

### Bot Status and Configuration

```http
GET /api/telegram/status
```

Returns bot status, configuration, and group mappings.

### Send Test Message

```http
POST /api/telegram/test
Content-Type: application/json

{
  "groupId": "-1001234567890",
  "message": "Test message (optional)"
}
```

### Manual Property Notification

```http
POST /api/telegram/notify/{propertyId}
```

Manually trigger a notification for a specific property.

### Bulk Notifications

```http
POST /api/telegram/bulk-notify
Content-Type: application/json

{
  "propertyIds": ["prop1", "prop2", "prop3"]
}
```

Or with filters:

```http
POST /api/telegram/bulk-notify
Content-Type: application/json

{
  "filters": {
    "city": "New York",
    "type": "apartment",
    "createdAfter": "2024-01-01"
  }
}
```

### Get Group Mapping

```http
GET /api/telegram/groups/{city}
```

Returns the group mapping for a specific city.

### Test with Recent Properties

```http
GET /api/telegram/test-recent?limit=5&hours=24
```

Sends notifications for recent properties (useful for testing).

## Message Format

Property notifications feature **dynamic titles** that describe the property and location specifically. The title format is: `{PropertyType} for rent in {Street}, {City}, {State}` (or equivalent in Spanish: `{PropertyType} en alquiler en {Street}, {City}, {State}`).

**Privacy Protection:** Property numbers are automatically removed from addresses to protect privacy. For example, "Calle de Vicente Blasco Ibáñez, 6" becomes "Calle de Vicente Blasco Ibáñez".

Property notifications are sent with the following format:

**Spanish Example (with description):**
```
🏠 **Apartamento en alquiler en Calle de Vicente Blasco Ibáñez, Zaragoza**

💰 **Alquiler:** EUR 850/mensual
📅 **Disponible:** 15/1/2024

🏡 **Detalles:**
• 2 Habitaciones, 1 Baños
• Calle de Vicente Blasco Ibáñez, Zaragoza, Aragón 50006
• Tipo: Apartamento
• Tamaño: 75 m²

✨ **Servicios:** WiFi, Parking, Gym, Pool, Laundry

📝 **Descripción:**
Precioso apartamento en el centro de Zaragoza con todas las comodidades...

#NuevaPropiedad #Zaragoza #Apartamento
```

**Spanish Example (without description):**
```
🏠 **Casa en alquiler en Ronda Litoral, l'Hospitalet de Llobregat, Barcelona**

💰 **Alquiler:** USD 134/mensual
📅 **Disponible:** Inmediatamente

🏡 **Detalles:**
• 5 Habitaciones, 2 Baños
• Ronda Litoral, l'Hospitalet de Llobregat, Barcelona 08907
• Tipo: Casa
• Tamaño: 213 m²

✨ **Servicios:** gym, pool, balcony, heating

#NuevaPropiedad #LHospitaletDeLlobregat #Casa
```

**English Example:**
```
🏠 **Room for rent in Carrer de Galícia, Cardedeu, Barcelona**

💰 **Rent:** EUR 400/monthly
📅 **Available:** 1/15/2024

🏡 **Details:**
• 1 Bedrooms, 1 Bathrooms
• Carrer de Galícia, Cardedeu, Barcelona 08440
• Type: Room
• Size: 20 m²

✨ **Amenities:** WiFi, Shared Kitchen, Balcony

📝 **Description:**
Cozy room in shared apartment with great transport connections...

#NewProperty #Cardedeu #Room
```

## Automatic Notifications

Notifications are automatically sent when:
- A new property is created via `POST /api/properties`
- A new property is created via the development endpoint

The system:
1. Extracts the city from the property's address
2. Determines the appropriate Telegram group
3. Formats the property information
4. Sends the notification (non-blocking)
5. Logs the result

## Error Handling

The system includes comprehensive error handling:
- Failed notifications don't block property creation
- Errors are logged for debugging
- Graceful degradation when bot is not configured
- Rate limiting to prevent spam

## Testing

### Test Bot Configuration

1. Check bot status:
```bash
curl GET /api/telegram/status
```

2. Send test message:
```bash
curl -X POST /api/telegram/test \
  -H "Content-Type: application/json" \
  -d '{"groupId": "-1001234567890", "message": "Test message"}'
```

3. Test with recent properties:
```bash
curl GET /api/telegram/test-recent?limit=3&hours=24
```

### Test Property Creation

Create a test property and verify the notification is sent:

```bash
curl -X POST /api/properties \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "type": "apartment",
    "bedrooms": 2,
    "bathrooms": 1,
    "rent": {
      "amount": 2500,
      "currency": "USD",
      "paymentFrequency": "monthly"
    },
    "address": {
      "street": "123 Test St",
      "city": "New York",
      "state": "NY",
      "zipCode": "10001"
    },
    "description": "Test property for Telegram notifications"
  }'
```

## Troubleshooting

### Common Issues

1. **Bot not sending messages**
   - Check if `TELEGRAM_NOTIFICATIONS_ENABLED=true`
   - Verify bot token is correct
   - Ensure bot is added to the target groups
   - Check server logs for error messages

2. **Messages going to wrong group**
   - Verify city name normalization
   - Check group ID configuration
   - Test group mapping with `/api/telegram/groups/{city}`

3. **Bot not responding**
   - Verify bot token is valid
   - Check if bot is blocked or restricted
   - Ensure bot has permission to send messages

### Debug Information

Check bot status and configuration:
```bash
curl /api/telegram/status
```

Check webhook information:
```bash
curl /api/telegram/webhook
```

### Log Messages

The system logs important events:
- Bot initialization
- Notification successes/failures
- Group mapping decisions
- API errors

Check your server logs for messages like:
- `Telegram bot initialized successfully`
- `Property notification sent to Telegram group`
- `Failed to send Telegram notification`

## Security Considerations

1. **Bot Token Security**
   - Never commit bot tokens to version control
   - Use environment variables
   - Rotate tokens periodically

2. **Group Access Control**
   - Only add bot to authorized groups
   - Monitor group membership
   - Remove bot from unused groups

3. **Rate Limiting**
   - Bulk operations are limited to 50 properties
   - 1-second delay between bulk messages
   - Consider implementing additional rate limiting

4. **Content Filtering**
   - Property descriptions are truncated to 200 characters
   - Sensitive information should not be included in notifications

## Customization

### Message Templates

Customize message format in `services/telegramService.js`:

```javascript
formatPropertyMessage(property) {
  // Customize message format here
  return `Your custom message template`;
}
```

### City Mappings

Add custom city mappings in `config.js`:

```javascript
groupMappings: {
  'your-city': process.env.TELEGRAM_GROUP_YOUR_CITY,
  // Add more mappings
}
```

### Notification Triggers

Add custom notification triggers in property controller or other services:

```javascript
const { telegramService } = require('../services');

// Trigger notification
telegramService.sendPropertyNotification(property)
  .catch(error => console.error('Notification failed:', error));
```

## Support

For issues or questions:
1. Check server logs for error messages
2. Test bot configuration with provided endpoints
3. Verify Telegram group setup
4. Review environment variable configuration 