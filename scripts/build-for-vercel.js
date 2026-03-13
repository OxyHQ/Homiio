#!/usr/bin/env node

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

console.log('🚀 Starting build process...');

// Ensure we're in the root directory
const rootDir = path.resolve(__dirname, '..');
process.chdir(rootDir);

try {
  // Step 1: Build shared-types first
  console.log('🔨 Building shared-types...');
  execSync('npm run build:shared-types', { stdio: 'inherit' });

  // Step 2: Ensure shared-types are properly linked
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

  // Copy built files and package.json to node_modules
  const sharedTypesRoot = path.join(rootDir, 'packages/shared-types');
  const sharedTypesPackageJson = path.join(sharedTypesRoot, 'package.json');

  [frontendNodeModules, backendNodeModules].forEach(dest => {
    if (fs.existsSync(sharedTypesDist)) {
      copyRecursive(sharedTypesDist, path.join(dest, 'dist'));
      // Copy package.json so Node can resolve the package
      if (fs.existsSync(sharedTypesPackageJson)) {
        fs.copyFileSync(sharedTypesPackageJson, path.join(dest, 'package.json'));
      }
      console.log(`✅ Shared-types copied to ${path.relative(rootDir, dest)}`);
    }
  });

  // Step 3: Check if we're building frontend or backend
  const target = process.env.DO_TARGET || process.env.VERCEL_TARGET || 'frontend';

  if (target === 'frontend') {
    console.log('🌐 Building frontend...');
    // expo export hangs after completing (Metro doesn't exit its event loop).
    // Use spawnSync with a 10-minute timeout; if killed, check output dir exists.
    const frontendDir = path.join(rootDir, 'packages/frontend');
    const outputDir = path.join(frontendDir, 'dist');
    const result = spawnSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', 'dist'], {
      stdio: 'inherit',
      cwd: frontendDir,
      timeout: 180000, // 3 minutes
      killSignal: 'SIGTERM',
      env: { ...process.env, EXPO_NO_TELEMETRY: '1' },
    });
    if (result.status !== 0 && result.status !== null) {
      throw new Error(`expo export failed with exit code ${result.status}`);
    }
    if (result.signal && !fs.existsSync(outputDir)) {
      throw new Error(`expo export was killed by ${result.signal} and no output was produced`);
    }
    if (result.signal) {
      console.log(`expo export was killed by ${result.signal} after timeout, but output exists — build OK`);
    }
  } else if (target === 'backend') {
    console.log('⚙️ Building backend...');
    execSync('npm run build:backend', { stdio: 'inherit' });
  } else {
    console.log('🔨 Building all packages...');
    execSync('npm run build', { stdio: 'inherit' });
  }

  console.log('✅ Build completed successfully!');
  process.exit(0);
} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
}
