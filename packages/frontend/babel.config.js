module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { unstable_transformImportMeta: true }],
      'nativewind/babel',
    ],
    plugins: [
      ['module:react-native-dotenv', {
        moduleName: '@env',
        path: '.env',
        allowUndefined: true,
        safe: false,
      }],
      ['module-resolver', {
        root: ['./'],
        alias: { '@': './' },
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json', '.svg'],
      }],
      '@babel/plugin-syntax-dynamic-import',
      '@babel/plugin-transform-export-namespace-from',
      // Reanimated 4.x uses worklets plugin instead
      'react-native-worklets/plugin',
    ],
  };
};
