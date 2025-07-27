#!/bin/bash

echo "🚀 Deploying Homiio Backend to Vercel..."

# Ensure we're in the root directory
cd "$(dirname "$0")/.."

# Create a temporary vercel.json for backend
cat > vercel.json << EOF
{
  "name": "homiio-backend",
  "buildCommand": "VERCEL_TARGET=backend node scripts/build-for-vercel.js",
  "outputDirectory": "packages/backend/dist",
  "installCommand": "npm install",
  "framework": null,
  "functions": {
    "packages/backend/dist/server.js": {
      "runtime": "nodejs18.x"
    }
  }
}
EOF

# Deploy to Vercel
vercel --prod

# Restore the original vercel.json
git checkout vercel.json

echo "✅ Backend deployment completed!" 