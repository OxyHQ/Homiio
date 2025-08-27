module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'nativewind' }], 'nativewind/babel'],
    plugins: [
      ['module:react-native-dotenv'],
      // Add module resolver for better import handling
      [
        'module-resolver',
        {
          root: ['.'],
          alias: {
            '@': './',
          },
          extensions: ['.js', '.jsx', '.ts', '.tsx', '.json'],
        },
      ],
      // Add support for dynamic imports
      '@babel/plugin-transform-dynamic-import',
      // Add support for export namespace from
      '@babel/plugin-proposal-export-namespace-from',
      // Add support for reanimated
      'react-native-reanimated/plugin', // Ensure this is the last plugin
    ],
  };
};
