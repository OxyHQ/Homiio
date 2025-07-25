const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

module.exports = (async () => {
  const config = await getDefaultConfig(__dirname);
  
  // Configure SVG support
  const { transformer, resolver } = config;

  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve("react-native-svg-transformer"),
    // Suppress CSS warnings
    unstable_allowRequireContext: true,
  };
  
  config.resolver = {
    ...resolver,
    assetExts: resolver.assetExts.filter((ext) => ext !== "svg"),
    sourceExts: [...resolver.sourceExts, "svg"]
  };

  // Suppress console warnings for unknown CSS rules
  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args[0] && typeof args[0] === 'string' && args[0].includes('@cssInterop')) {
      return; // Suppress cssInterop warnings
    }
    originalWarn.apply(console, args);
  };
  
  // Apply NativeWind configuration
  withNativeWind(config, { input: './global.css' });
})();