// Custom SVG transformer for Expo 55 monorepo setup
// react-native-svg-transformer is hoisted to root but @expo/metro-config
// is in the frontend workspace, causing resolution failures.
// This wrapper resolves the upstream transformer from the correct location.
const { resolveConfig, transform } = require('@svgr/core');
const resolveConfigDir = require('path-dirname');

const upstreamTransformer = require(
  require.resolve('@expo/metro-config/babel-transformer', { paths: [__dirname] })
);

const defaultSVGRConfig = {
  native: true,
  plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
  svgoConfig: {
    plugins: [
      {
        name: 'preset-default',
        params: {
          overrides: {
            inlineStyles: { onlyMatchedOnce: false },
            removeViewBox: false,
            removeUnknownsAndDefaults: false,
            convertColors: false,
          },
        },
      },
    ],
  },
};

module.exports.transform = async ({ src, filename, ...rest }) => {
  if (filename.endsWith('.svg')) {
    const config = await resolveConfig(resolveConfigDir(filename));
    const svgrConfig = config
      ? { ...defaultSVGRConfig, ...config }
      : defaultSVGRConfig;
    return upstreamTransformer.transform({
      src: await transform(src, svgrConfig, { filePath: filename }),
      filename,
      ...rest,
    });
  }
  return upstreamTransformer.transform({ src, filename, ...rest });
};
