# Homiio Monorepo

A monorepo containing the Homiio frontend and backend applications.

## 🏗️ Project Structure

```
homiio-monorepo/
├── packages/
│   ├── frontend/          # React Native/Expo frontend application
│   ├── backend/           # Node.js/Express backend API
│   └── shared-types/      # Shared TypeScript types
├── package.json           # Root package.json with workspace configuration
└── README.md             # This file
```

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 8.0.0
- Expo CLI (for frontend development)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd homiio-monorepo
```

2. Install all dependencies:
```bash
npm run install:all
```

### Development

#### Start all services in development mode:
```bash
npm run dev
```

#### Start individual services:

**Frontend (React Native/Expo):**
```bash
npm run dev:frontend
# or
npm run start:frontend
```

**Backend (Node.js/Express):**
```bash
npm run dev:backend
# or
npm run start:backend
```

### Building

#### Build all packages:
```bash
npm run build
```

#### Build individual packages:
```bash
npm run build:frontend
npm run build:backend
```

### Testing

Run tests for all packages:
```bash
npm run test
```

### Linting

Run linting for all packages:
```bash
npm run lint
```

### Cleaning

Clean all build artifacts and node_modules:
```bash
npm run clean
```

## 🚀 Deployment

### Vercel Deployment

The monorepo is configured for deployment to Vercel with proper shared-types handling.

#### Frontend Deployment
```bash
./scripts/deploy-frontend.sh
```

#### Backend Deployment
```bash
./scripts/deploy-backend.sh
```

For detailed deployment instructions, see [VERCEL_DEPLOYMENT.md](./VERCEL_DEPLOYMENT.md).

## 📦 Packages

### Frontend (`packages/frontend`)
- React Native application built with Expo
- Uses TypeScript, Tailwind CSS, and NativeWind
- Includes mobile and web platforms

### Backend (`packages/backend`)
- Node.js/Express API server
- TypeScript backend with MongoDB
- Authentication and device management

### Shared Types (`packages/shared-types`)
- Common TypeScript interfaces and types

## 🔐 Authentication & Profile Management

### Automatic Profile Creation
When a user signs in or signs up with Oxy, the system automatically creates a personal profile for them if one doesn't already exist. This happens transparently in the background:

1. **Frontend**: The `ProfileProvider` component automatically loads profiles when a user authenticates
2. **Backend**: The `getOrCreateActiveProfile` endpoint automatically creates a default personal profile if none exists
3. **Default Profile**: Includes basic settings, trust score initialization, and privacy preferences

### Profile Types
- **Personal**: Default profile type for individual users
- **Agency**: For property management agencies
- **Business**: For business entities
- **Cooperative**: For housing cooperatives

### Trust Score System
Each personal profile includes an automatic trust score calculation based on:
- Profile completion
- Verification status
- Rental history
- References
- Common TypeScript interfaces and types
- Shared between frontend and backend
- Ensures type consistency across the application
- **Status**: ✅ **IMPLEMENTED** - 50+ shared types covering Property, Profile, City, Lease, and Address domains
- **Documentation**: See [SHARED_TYPES_IMPLEMENTATION.md](./SHARED_TYPES_IMPLEMENTATION.md) for detailed information

## 🔧 Workspace Scripts

The root `package.json` includes several workspace scripts for managing the monorepo:

- `dev`: Start all packages in development mode
- `build`: Build all packages
- `test`: Run tests for all packages
- `lint`: Run linting for all packages
- `clean`: Clean all build artifacts
- `install:all`: Install dependencies for all packages

## 🛠️ Development Workflow

1. **Adding new packages**: Create a new directory in `packages/` and add a `package.json`
2. **Shared dependencies**: Add common dependencies to the root `package.json`
3. **Package-specific dependencies**: Add to individual package `package.json` files
4. **Type sharing**: Use the `shared-types` package for common interfaces

## 📝 Environment Variables

Each package may have its own environment variables. Check the individual package READMEs for specific configuration requirements.

## 🤝 Contributing

1. Make changes in the appropriate package
2. Test your changes locally
3. Ensure all packages build successfully
4. Submit a pull request

## 📄 License

This project is private and proprietary. 