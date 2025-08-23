# Homio Backend API

A comprehensive housing and rental solutions API built with Express.js, designed to manage properties, rooms, tenants, and more.

## Features

- **Property Management**: Create, read, update, and delete properties
- **Room Management**: Manage individual rooms within properties
- **User Authentication**: Integration with Oxy ecosystem
- **Search & Filtering**: Advanced property and room search capabilities
- **API Documentation**: RESTful API with comprehensive endpoints

## Tech Stack

- **Framework**: Express.js
- **Authentication**: Oxy Services integration
- **Validation**: Express Validator
- **Logging**: Custom logging middleware
- **Error Handling**: Centralized error management

## Project Structure

```
packages/backend/
├── controllers/          # Request handlers
│   ├── propertyController.ts
│   ├── roomController.ts
│   └── index.ts
├── models/              # Data models
│   ├── Property.ts
│   ├── Room.ts
│   ├── User.ts
│   ├── Lease.ts
│   ├── Payment.ts
│   └── index.ts
├── routes/              # API routes
│   ├── properties.ts
│   ├── rooms.ts
│   └── index.ts
├── middlewares/         # Express middlewares
│   ├── auth.ts
│   ├── validation.ts
│   ├── errorHandler.ts
│   ├── logging.ts
│   └── index.ts
├── services/           # Business logic
│   └── index.ts
├── utils/              # Utility functions
│   ├── helpers.ts
│   └── index.ts
├── config.ts           # Configuration
├── server.ts           # Application entry point
└── package.json
```

## API Endpoints

### Properties

- `GET /api/properties` - List all properties (public)
- `POST /api/properties` - Create a new property (authenticated)
- `GET /api/properties/:id` - Get property details (public)
- `PUT /api/properties/:id` - Update property (authenticated, owner only)
- `DELETE /api/properties/:id` - Delete property (authenticated, owner only)
- `GET /api/properties/my/properties` - Get current user's properties

### Rooms

- `GET /api/properties/:propertyId/rooms` - List rooms in a property
- `POST /api/properties/:propertyId/rooms` - Create a room (authenticated)
- `GET /api/properties/:propertyId/rooms/:roomId` - Get room details
- `PUT /api/properties/:propertyId/rooms/:roomId` - Update room (authenticated)
- `DELETE /api/properties/:propertyId/rooms/:roomId` - Delete room (authenticated)
- `GET /api/properties/:propertyId/rooms/search` - Search available rooms
- `PATCH /api/properties/:propertyId/rooms/:roomId/availability` - Update room availability

### Health & Testing

- `GET /health` - Public health check
- `GET /api/health` - API health check
- `POST /api/test` - Test authenticated endpoint

## Getting Started

### Prerequisites

- Node.js 16+
- npm or yarn
- Oxy ecosystem account (for authentication)

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your configuration
```

3. Start the development server:
```bash
npm run dev
```

4. Start production server:
```bash
npm start
```

## Environment Variables

```env
NODE_ENV=development
PORT=4000
OXY_API_URL=http://localhost:3001
DATABASE_URL=mongodb://localhost:27017/homiio
JWT_SECRET=your_jwt_secret
```

## Models

### Property
- Basic property information (title, description, address)
- Rent details and availability
- Amenities and rules
- Image and document management

### Room
- Individual room details within properties
- Rent and availability per room
- Roommate preferences and matching
- Furniture and amenities
- Occupancy management

### User
- User profiles and preferences
- Verification status
- Trust scores and ratings
- Subscription management

### Lease
- Rental agreements between landlords and tenants
- Terms and conditions
- Digital signatures
- Status tracking

### Payment
- Rent payments and transaction history
- Multiple payment methods
- Fee calculations
- Receipt management

## Authentication

The API uses Oxy Services for authentication. Include the authentication token in the Authorization header:

```
Authorization: Bearer <your_token>
```

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "error": {
    "message": "Error description",
    "code": "ERROR_CODE",
    "statusCode": 400
  }
}
```

## Response Format

Successful responses follow this format:

```json
{
  "success": true,
  "message": "Operation successful",
  "data": {...},
  "meta": {
    "timestamp": "2025-06-19T10:30:00.000Z"
  }
}
```

Paginated responses include pagination metadata:

```json
{
  "success": true,
  "message": "Data retrieved successfully",
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "totalPages": 10,
    "hasNext": true,
    "hasPrev": false
  }
}
```

## Development

### Scripts

- `npm start` - Start production server
- `npm run dev` - Start development server with nodemon
- `npm run build` - Install latest dependencies
- `npm test` - Run tests (placeholder)

### Code Style

- Use ES6+ features
- Follow consistent naming conventions
- Add JSDoc comments for functions
- Handle errors appropriately
- Use async/await for asynchronous operations

## Future Enhancements

- Database integration (MongoDB/PostgreSQL)
- Real-time WebSocket connections
- File upload and image processing
- Advanced search with Elasticsearch
- Email notifications
- SMS integration
- Mobile app APIs
- AI-powered matching algorithms

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

ISC License
