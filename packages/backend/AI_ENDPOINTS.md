# AI Endpoints Documentation

This document describes the AI-powered endpoints available in the Homiio backend.

## Authentication

All AI endpoints require authentication using Oxy-based authentication. Include the appropriate authorization header in your requests.

## Endpoints

### 1. POST /api/ai/stream

Stream text generation using OpenAI GPT-4o.

**Request Body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ]
}
```

**Response:**
- Content-Type: `application/octet-stream`
- Streaming response with generated text

**Example Usage:**
```javascript
const response = await fetch('/api/ai/stream', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer YOUR_TOKEN'
  },
  body: JSON.stringify({
    messages: [
      { role: 'user', content: 'Tell me about ethical housing' }
    ]
  })
});

// Handle streaming response
const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const chunk = decoder.decode(value);
  console.log('Received chunk:', chunk);
}
```

### 2. POST /api/ai/chat

Non-streaming chat completion using OpenAI GPT-4o.

**Request Body:**
```json
{
  "messages": [
    {
      "role": "user",
      "content": "Hello, how are you?"
    }
  ],
  "maxTokens": 1000
}
```

**Response:**
```json
{
  "success": true,
  "response": "I'm doing well, thank you for asking!",
  "usage": {
    "promptTokens": 10,
    "completionTokens": 15,
    "totalTokens": 25
  },
  "userId": "user_id",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 3. GET /api/ai/health

Check the health and configuration status of the AI service.

**Response:**
```json
{
  "status": "ok",
  "service": "AI Streaming Service",
  "features": ["text-streaming", "chat-completion"],
  "configuration": {
    "model": "gpt-4o",
    "apiKeyConfigured": true,
    "organizationConfigured": false
  },
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## Environment Variables

The following environment variables are required for AI functionality:

- `OPENAI_API_KEY`: Your OpenAI API key
- `OPENAI_ORG_ID`: (Optional) Your OpenAI organization ID
- `OPENAI_MODEL`: (Optional) Model to use (defaults to 'gpt-4o')

## Error Handling

All endpoints return appropriate HTTP status codes:

- `200`: Success
- `400`: Bad request (invalid input)
- `401`: Unauthorized (missing or invalid token)
- `500`: Server error (API key not configured, OpenAI error, etc.)

## Rate Limiting

AI endpoints are subject to rate limiting to prevent abuse. The current limits are:
- 100 requests per 15 minutes per IP address

## Security Considerations

1. All AI endpoints require authentication
2. API keys are validated before processing requests
3. Input is validated to prevent injection attacks
4. Responses are properly sanitized

## Usage Examples

### Frontend Integration

```javascript
// Using the streaming endpoint
const streamResponse = async (messages) => {
  const response = await fetch('/api/ai/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ messages })
  });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    const chunk = decoder.decode(value);
    // Handle the streaming chunk
    console.log(chunk);
  }
};

// Using the chat endpoint
const chatResponse = async (messages) => {
  const response = await fetch('/api/ai/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ messages })
  });

  const data = await response.json();
  return data.response;
};
``` 