#!/bin/bash

# Homiio Monorepo Development Setup Script

echo "🚀 Setting up Homiio Monorepo..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js >= 18.0.0"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version 18 or higher is required. Current version: $(node -v)"
    exit 1
fi

echo "✅ Node.js version: $(node -v)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Build shared types
echo "🔨 Building shared types..."
cd packages/shared-types && npm run build && cd ../..

# Install workspace dependencies
echo "🔗 Installing workspace dependencies..."
npm install --workspaces

echo "✅ Setup complete!"
echo ""
echo "🎯 Available commands:"
echo "  npm run dev              - Start all services in development mode"
echo "  npm run dev:frontend     - Start frontend only"
echo "  npm run dev:backend      - Start backend only"
echo "  npm run build            - Build all packages"
echo "  npm run test             - Run tests for all packages"
echo "  npm run lint             - Run linting for all packages"
echo ""
echo "📁 Project structure:"
echo "  packages/frontend/       - React Native/Expo app"
echo "  packages/backend/        - Node.js/Express API"
echo "  packages/shared-types/   - Shared TypeScript types"
echo ""
echo "🚀 Happy coding!" 