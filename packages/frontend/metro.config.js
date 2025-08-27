const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

module.exports = (async () => {
  const config = await getDefaultConfig(__dirname);

  // Configure SVG support
  const { transformer, resolver } = config;

  config.transformer = {
    ...transformer,
    babelTransformerPath: require.resolve('react-native-svg-transformer'),
  };

  config.resolver = {
    ...resolver,
    assetExts: resolver.assetExts.filter((ext) => ext !== 'svg'),
    sourceExts: [...resolver.sourceExts, 'svg'],
    // Add resolver configurations to help with module resolution
    resolverMainFields: ['react-native', 'browser', 'main'],
    // Add platforms to ensure proper resolution
    platforms: ['ios', 'android', 'native', 'web'],
  };

  // Apply NativeWind configuration
  return withNativeWind(config, { input: './styles/global.css' });
})();
