# @homiio/shared-types

Shared TypeScript types and interfaces for the Homiio monorepo.

## Usage

This package contains common TypeScript interfaces and types that are shared between the frontend and backend applications.

### Installation

The package is automatically available in the monorepo workspace. In other packages, you can import types like this:

```typescript
import { User, AuthResponse, ApiResponse } from '@homiio/shared-types';
```

### Available Types

#### User Types
- `User` - User interface with id, email, name, avatar, and timestamps
- `LoginRequest` - Login request payload
- `RegisterRequest` - Registration request payload
- `AuthResponse` - Authentication response with user and tokens

#### API Types
- `ApiResponse<T>` - Generic API response wrapper
- `PaginationParams` - Pagination parameters
- `PaginatedResponse<T>` - Paginated API response

#### Device Types
- `Device` - Device information for multi-device support

### Development

To add new shared types:

1. Add the type definition to `src/index.ts`
2. Build the package: `npm run build`
3. The types will be available to other packages in the monorepo

### Building

```bash
npm run build
```

This will compile TypeScript to JavaScript and generate type definitions in the `dist/` directory. 