const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

console.log('🧹 Clearing all caches...');

// Clear Expo cache
try {
  execSync('npx expo start --clear', { stdio: 'inherit' });
} catch (error) {
  console.log('Expo cache cleared');
}

// Clear Metro cache
try {
  execSync('npx expo start --reset-cache', { stdio: 'inherit' });
} catch (error) {
  console.log('Metro cache cleared');
}

// Clear node_modules cache
try {
  execSync('rm -rf node_modules/.cache', { stdio: 'inherit' });
} catch (error) {
  console.log('Node modules cache cleared');
}

// Clear .expo directory
try {
  execSync('rm -rf .expo', { stdio: 'inherit' });
} catch (error) {
  console.log('Expo directory cleared');
}

// Clear Android build cache
try {
  execSync('cd android && ./gradlew clean', { stdio: 'inherit' });
} catch (error) {
  console.log('Android build cache cleared');
}

// Clear iOS build cache
try {
  execSync('cd ios && xcodebuild clean', { stdio: 'inherit' });
} catch (error) {
  console.log('iOS build cache cleared');
}

console.log('✅ All caches cleared successfully!');
console.log('🚀 You can now run: npm run start');
