# Telegram Topic-Based Notifications

This document describes the implementation of topic-specific Telegram notifications for property listings based on city and country combinations.

## Overview

The Telegram service now supports sending property notifications to specific topics within Telegram groups using the `message_thread_id` parameter. This allows for better organization of property listings by location.

## Supported Locations

Currently, the following city-country combinations are supported:

| City | Country | Topic ID | Description |
|------|---------|----------|-------------|
| New York | US | 4 | New York properties |
| Barcelona | Spain | 2 | Barcelona properties |

## Configuration

The topic mappings are defined in the `CITY_TOPIC_MAPPING` constant in `telegramService.ts`:

```typescript
const CITY_TOPIC_MAPPING = {
  'New York, US': 4,
  'Barcelona, Spain': 2,
  // Add more mappings as needed
  // Format: 'City, Country': topicId
};
```

## How It Works

### 1. Location Validation
When a property is created or updated, the system checks if the city and country combination is supported:

```typescript
const isSupported = telegramService.isLocationSupported(city, country);
```

### 2. Topic ID Retrieval
If the location is supported, the system retrieves the corresponding topic ID:

```typescript
const topicId = telegramService.getTopicIdForLocation(city, country);
```

### 3. Message Sending
The message is sent to the Telegram group with the topic ID included:

```typescript
const messageOptions = {
  caption: message,
  parse_mode: 'Markdown',
  reply_markup: keyboard,
  message_thread_id: topicId // This targets the specific topic
};
```

## API Endpoints

### Test Location Support
```http
GET /api/telegram/check-location-support?city=New York&country=US
```

Response:
```json
{
  "success": true,
  "data": {
    "city": "New York",
    "country": "US",
    "isSupported": true,
    "topicId": 4,
    "locationKey": "New York, US"
  }
}
```

### Test Location Support Functionality
```http
POST /api/telegram/test-location-support
```

This endpoint runs comprehensive tests to verify the location support functionality.

### Send Test Message with Topic
```http
POST /api/telegram/test-message
Content-Type: application/json

{
  "groupId": "-1002750613848",
  "message": "Test message",
  "topicId": 4
}
```

### Send Property Notification
```http
POST /api/telegram/notify/:propertyId
```

This will automatically determine the topic ID based on the property's location and send the notification to the appropriate topic.

## Behavior

### Supported Locations
- Properties in supported city-country combinations will be sent to the corresponding topic
- The notification includes the property details, image, and a link to view the full listing

### Unsupported Locations
- Properties in unsupported locations will be skipped
- No notification will be sent
- The system logs this as an informational message

### Error Handling
- If the Telegram bot is not initialized, notifications are skipped
- If image sending fails, the system falls back to text-only messages
- All errors are logged with detailed context

## Testing

### Manual Testing
Use the provided test script to verify functionality:

```bash
cd packages/backend
node scripts/test-telegram-topics.js
```

### API Testing
Test the endpoints using curl or any HTTP client:

```bash
# Check if New York, US is supported
curl "http://localhost:4000/api/telegram/check-location-support?city=New York&country=US"

# Test location support functionality
curl -X POST "http://localhost:4000/api/telegram/test-location-support"

# Send a test message to topic 4
curl -X POST "http://localhost:4000/api/telegram/test-message" \
  -H "Content-Type: application/json" \
  -d '{"groupId": "-1002750613848", "message": "Test message", "topicId": 4}'
```

## Adding New Locations

To add support for new city-country combinations:

1. Update the `CITY_TOPIC_MAPPING` constant in `telegramService.ts`
2. Add the corresponding topic ID for the Telegram group
3. Test the functionality using the provided test endpoints
4. Update this documentation

Example:
```typescript
const CITY_TOPIC_MAPPING = {
  'New York, US': 4,
  'Barcelona, Spain': 2,
  'Madrid, Spain': 3,  // New location
  'London, UK': 5      // New location
};
```

## Logging

The system provides comprehensive logging for debugging:

- Location support checks
- Topic ID retrieval
- Message sending attempts
- Success/failure status
- Error details with context

## Production Considerations

1. **Rate Limiting**: The system includes delays between bulk notifications to avoid Telegram's rate limits
2. **Error Handling**: All errors are caught and logged without breaking the application
3. **Fallback**: If image sending fails, the system falls back to text-only messages
4. **Validation**: Location validation prevents unnecessary API calls for unsupported locations

## Security

- Topic IDs are validated before use
- Only supported locations can trigger notifications
- All API endpoints require proper authentication
- Error messages don't expose sensitive information 