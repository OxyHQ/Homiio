# Homiio Monorepo Development Instructions

**CRITICAL**: Always follow these instructions first and fallback to additional search and context gathering only when the information in the instructions is incomplete or found to be in error.

## Repository Overview

Homiio is a React Native/Expo housing and rental platform with a Node.js backend. The monorepo contains three main packages:

- `packages/frontend/` - React Native/Expo mobile and web application
- `packages/backend/` - Node.js/Express API server 
- `packages/shared-types/` - Shared TypeScript type definitions

## Prerequisites and Setup

### Required Software
- **Node.js >= 18.0.0** - Download from https://nodejs.org/
- **npm >= 8.0.0** - Comes with Node.js
- **Expo CLI** - Install globally: `npm install -g @expo/cli`
- **MongoDB** - For backend database (optional for development)

### Initial Repository Setup

**CRITICAL**: Always run these commands in exact order when working with a fresh clone:

```bash
# 1. Clone and navigate to repository
git clone <repository-url>
cd homiio-monorepo

# 2. Install all dependencies (takes ~30 seconds)
npm install

# 3. Build shared types first (REQUIRED before other builds)
npm run build:shared-types

# 4. Install workspace dependencies
npm install --workspaces
```

**Alternative**: Use the provided setup script:
```bash
./scripts/dev-setup.sh
```

## Building and Testing

### Build Commands

**Build all packages:**
```bash
npm run build
```
- **Time**: 15-90 seconds depending on frontend inclusion
- **NEVER CANCEL**: Set timeout to 120+ seconds minimum
- **Note**: Includes TypeScript compilation for all packages

**Build individual packages:**
```bash
# Shared types (ALWAYS build first) - 1-2 seconds
npm run build:shared-types

# Frontend only - 60-90 seconds
npm run build:frontend

# Backend only - 1-2 seconds  
npm run build:backend
```

### Linting

```bash
npm run lint
```
- **Time**: 8-10 seconds
- **Expected**: Many warnings in frontend (121+ warnings normal)
- **Critical**: Backend ESLint configuration has module import issues
- **Status**: Linting completes but with configuration warnings

### Testing

```bash
npm run test
```
- **Time**: <1 second (currently no tests implemented)
- **Status**: Backend and frontend have placeholder test scripts
- **Note**: Shared-types returns success with no tests

## Development Workflow

### Starting Development Servers

**Start all services:**
```bash
npm run dev
```

**Start individual services:**

**Frontend Development:**
```bash
# For web development (recommended for testing)
cd packages/frontend
npx expo start --web --reset-cache --clear

# For mobile development (requires tunnel setup)
npm run dev:frontend
```
- **URL**: http://localhost:8081 (Metro bundler)
- **Time to start**: 30-60 seconds for initial bundle
- **NEVER CANCEL**: Metro bundling can take up to 2 minutes on first run

**Backend Development:**
```bash
npm run dev:backend
```
- **Default port**: 4000 (configurable via ENV)
- **Time to start**: 5-10 seconds
- **Requires**: MongoDB connection (will crash without database)
- **Note**: Use nodemon for auto-restart on file changes

### Environment Configuration

**Backend Environment Variables:**
```env
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://localhost:27017/homiio
JWT_SECRET=your_jwt_secret_here
OXY_API_URL=http://localhost:3001
```

**Frontend Environment Variables:**
```env
EXPO_PUBLIC_API_URL=http://localhost:4000
EXPO_PUBLIC_OXY_CLIENT_ID=your_client_id
EXPO_PUBLIC_OXY_REDIRECT_URI=your_redirect_uri
```

## Validation and Testing Scenarios

### Manual Validation Requirements

**ALWAYS test these scenarios after making changes:**

1. **Build Validation:**
   - Run full build: `npm run build`
   - Verify all packages compile without errors
   - Check that shared-types are properly linked

2. **Frontend Validation:**
   - Start web development server: `cd packages/frontend && npx expo start --web`
   - Navigate to http://localhost:8081
   - Verify application loads and basic navigation works
   - Test responsive design on different screen sizes

3. **Backend Validation:**
   - Start backend server: `npm run dev:backend` 
   - Test health endpoint: `curl http://localhost:4000/health`
   - Verify API endpoints are accessible
   - Check database connection (if MongoDB available)

4. **Type Safety Validation:**
   - Make changes to shared-types and rebuild: `npm run build:shared-types`
   - Verify both frontend and backend compile successfully
   - Test import statements in both packages

### Common Development Tasks

**Adding New Shared Types:**
1. Edit files in `packages/shared-types/src/`
2. Build shared-types: `npm run build:shared-types`
3. Verify imports work in both frontend and backend
4. Always test full build: `npm run build`

**Frontend Development:**
1. Navigate to `packages/frontend/`
2. Start web server for testing: `npx expo start --web`
3. Edit files in `app/`, `components/`, or `features/`
4. Test on web browser at http://localhost:8081
5. For mobile testing, use tunnel mode: `npm run dev:frontend`

**Backend Development:**
1. Navigate to `packages/backend/`
2. Start development server: `npm run dev`
3. Test API endpoints with curl or Postman
4. Check server logs for errors
5. Restart server when adding new dependencies

## Critical Build Dependencies

### Shared Types Dependency Chain
**CRITICAL**: Always build shared-types before other packages:
```bash
# Correct order:
npm run build:shared-types  # Must be first
npm run build:frontend     # Can reference shared-types
npm run build:backend      # Can reference shared-types
```

### TypeScript Project References
- Backend and frontend both reference `../shared-types` 
- Use `npm run build:shared-types` after modifying shared types
- TypeScript compilation will fail if shared-types are not built first

## Package-Specific Information

### Frontend (`packages/frontend/`)
- **Framework**: React Native with Expo
- **Styling**: TailwindCSS via NativeWind
- **State Management**: Zustand
- **Key Scripts**: `dev`, `build`, `lint`, `start`
- **Output**: `dist/` folder for web builds
- **Dev Server**: Metro bundler on port 8081

### Backend (`packages/backend/`)
- **Framework**: Express.js with TypeScript
- **Database**: MongoDB with Mongoose
- **Authentication**: Oxy Services integration
- **Key Scripts**: `dev`, `build`, `start`, `lint`
- **Dev Tool**: nodemon for auto-reload
- **Port**: 4000 (default)

### Shared Types (`packages/shared-types/`)
- **Purpose**: Type definitions shared between frontend and backend
- **Module System**: CommonJS (resolved module compatibility issues)
- **Key Scripts**: `build`, `dev` (watch mode), `clean`
- **Output**: `dist/` with `.d.ts` and `.js` files

## Common Issues and Solutions

### Build Failures
1. **"Cannot find module @homiio/shared-types"**
   - Run: `npm run build:shared-types`
   - Ensure shared-types built successfully before other packages

2. **TypeScript compilation errors**
   - Check for missing shared-types build
   - Verify imports use correct paths
   - Run: `npm install --workspaces` to refresh workspace links

3. **Expo CLI not found**
   - Install globally: `npm install -g @expo/cli`
   - Use npx alternative: `npx expo start --web`

### Runtime Issues
1. **Backend crashes with database errors**
   - Ensure MongoDB is running locally
   - Check connection string in environment variables
   - Backend will crash without database connectivity

2. **Frontend bundle errors**
   - Clear Metro cache: `npx expo start --clear`
   - Reset project cache: `npm run clear-cache` (frontend package)
   - Reinstall dependencies: `rm -rf node_modules && npm install`

## Scripts Reference

### Root Package Scripts
- `npm run dev` - Start all services in development mode
- `npm run build` - Build all packages (15-90 seconds)
- `npm run test` - Run tests for all packages (currently minimal)
- `npm run lint` - Run linting for all packages (8-10 seconds)
- `npm run clean` - Clean all build artifacts and node_modules
- `npm run install:all` - Install dependencies for all packages

### Deployment Scripts
- `./scripts/deploy-frontend.sh` - Deploy frontend to Vercel
- `./scripts/deploy-backend.sh` - Deploy backend to Vercel  
- `./scripts/build-for-vercel.js` - Special build process for Vercel deployment

## Performance Notes

### Build Performance
- **Initial npm install**: ~30 seconds
- **Shared-types build**: 1-2 seconds
- **Backend build**: 1-2 seconds  
- **Frontend build**: 60-90 seconds (includes Metro bundling)
- **Full monorepo build**: 15-90 seconds total

### Development Server Startup
- **Backend dev server**: 5-10 seconds
- **Frontend Metro bundler**: 30-60 seconds initial, 1-5 seconds reloads
- **First-time bundling**: Can take up to 2 minutes

**CRITICAL**: Never cancel builds or long-running commands. Set timeouts of 120+ seconds for builds and 180+ seconds for initial frontend bundling.

## Git Workflow Notes

### Pre-commit Validation
Always run before committing:
```bash
npm run build        # Ensure everything compiles
npm run lint         # Check for critical lint errors
```

### Common File Locations
- **App screens**: `packages/frontend/app/`
- **UI Components**: `packages/frontend/components/`
- **API Controllers**: `packages/backend/controllers/`
- **API Routes**: `packages/backend/routes/`
- **Type Definitions**: `packages/shared-types/src/`
- **Documentation**: `packages/*/docs/` and root `*.md` files

This completes the essential development workflow for the Homiio monorepo. Always reference these instructions first before exploring additional solutions or searching for alternatives.