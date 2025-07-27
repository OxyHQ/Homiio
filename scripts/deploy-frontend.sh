#!/bin/bash

echo "🚀 Deploying Homiio Frontend to Vercel..."

# Ensure we're in the root directory
cd "$(dirname "$0")/.."

# Set the VERCEL_TARGET environment variable
export VERCEL_TARGET=frontend

# Deploy to Vercel
vercel --prod

echo "✅ Frontend deployment completed!" 