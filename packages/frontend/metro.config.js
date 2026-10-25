const { createOxyMetroConfig } = require('@oxy.so/app-preset/metro');
const { withGoWayMaps } = require('@goway.to/maps/metro');

// Web fetches the active locale from `public/locales/` instead of bundling all
// twelve; publish this checkout's `locales/` there before Metro serves `public/`.
require('./scripts/publish-web-locales').publishWebLocales();

// `@homiio/shared-types` is bundled from its TypeScript SOURCE, through the
// `paths` entry in tsconfig.json that `tsc` and Jest already resolve it with
// (Expo's Metro reads tsconfig `paths`). That is why `sharedTypesPackage` is
// NOT passed: the preset would block `packages/shared-types/src` and send
// Metro to the package's built `dist/`, a cache nothing guarantees is
// complete — a release bundle failed on `Unable to resolve "./housingFeature"
// from "packages/shared-types/dist/index.js"` because of a partial one.
//
// `withGoWayMaps` serves MapLibre's worker from `public/vendor/` (maplibre-gl 6
// starts it by URL), before Metro serves or exports `public/`.
const config = withGoWayMaps(
  createOxyMetroConfig(__dirname, {
    cssInput: './styles/global.css',
  }),
);

// JavaScript is served as UTF-8; keep literal text compact instead of expanding
// every non-ASCII character into a six-byte Unicode escape.
config.transformer.minifierConfig.output.ascii_only = false;

module.exports = config;
