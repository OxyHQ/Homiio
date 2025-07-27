#!/usr/bin/env node

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting Vercel build process...');

// Ensure we're in the root directory
const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

try {
  // Step 1: Install dependencies
  console.log('📦 Installing dependencies...');
  execSync('npm install', { stdio: 'inherit' });

  // Step 2: Build shared-types first
  console.log('🔨 Building shared-types...');
  execSync('npm run build:shared-types', { stdio: 'inherit' });

  // Step 3: Ensure shared-types are properly linked for Vercel
  console.log('🔗 Linking shared-types...');
  const sharedTypesDist = path.join(rootDir, 'packages/shared-types/dist');
  const frontendNodeModules = path.join(rootDir, 'packages/frontend/node_modules/@homiio/shared-types');
  const backendNodeModules = path.join(rootDir, 'packages/backend/node_modules/@homiio/shared-types');

  // Create directories if they don't exist
  [frontendNodeModules, backendNodeModules].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });

  // Copy built files to node_modules
  const copyRecursive = (src, dest) => {
    if (fs.statSync(src).isDirectory()) {
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(dest, { recursive: true });
      }
      fs.readdirSync(src).forEach(file => {
        copyRecursive(path.join(src, file), path.join(dest, file));
      });
    } else {
      fs.copyFileSync(src, dest);
    }
  };

  // Copy to frontend node_modules
  if (fs.existsSync(sharedTypesDist)) {
    copyRecursive(sharedTypesDist, frontendNodeModules);
    console.log('✅ Shared-types copied to frontend node_modules');
  }

  // Copy to backend node_modules
  if (fs.existsSync(sharedTypesDist)) {
    copyRecursive(sharedTypesDist, backendNodeModules);
    console.log('✅ Shared-types copied to backend node_modules');
  }

  // Step 4: Check if we're building frontend or backend
  const target = process.env.VERCEL_TARGET || 'frontend';
  
  if (target === 'frontend') {
    console.log('🌐 Building frontend...');
    execSync('npm run build:frontend', { stdio: 'inherit' });
  } else if (target === 'backend') {
    console.log('⚙️ Building backend...');
    execSync('npm run build:backend', { stdio: 'inherit' });
  } else {
    console.log('🔨 Building all packages...');
    execSync('npm run build', { stdio: 'inherit' });
  }

  console.log('✅ Build completed successfully!');
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
} 