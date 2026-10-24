const pkg = require('./package.json');
const { oxySplashScreenPlugin } = require('@oxy.so/expo-splash/config');

module.exports = (config) => {
  /**
   * App version number. Should be incremented as part of a release cycle.
   */
  const VERSION = pkg.version;

  /**
   * Uses built-in Expo env vars
   *
   * @see https://docs.expo.dev/build-reference/variables/#built-in-environment-variables
   */
  const PLATFORM = process.env.EAS_BUILD_PLATFORM;

  // ONE build variant, chosen explicitly: `APP_VARIANT=development` builds the
  // development app, anything else (unset included) is the production app.
  //
  // It lets a development build sit next to the production app on the SAME
  // device by giving it a distinct applicationId/bundleId + name, and it is the
  // only thing that decides whether dev-only entries (the `localhost` link host)
  // ship. That used to be `IS_DEV = !IS_TESTFLIGHT || !IS_PRODUCTION`, read off
  // `EXPO_PUBLIC_ENV`: true for every build that was not BOTH TestFlight and
  // production at once, which is every build, so release builds claimed
  // `http://localhost:4130`. `__tests__/appConfig.test.ts` asserts a production
  // config names no local host.
  const IS_DEV_VARIANT = process.env.APP_VARIANT === 'development';
  const APP_ID = IS_DEV_VARIANT ? 'com.homiio.android.dev' : 'com.homiio.android';
  const APP_NAME = IS_DEV_VARIANT ? 'Homiio (Dev)' : 'Homiio';

  return {
    expo: {
      name: APP_NAME,
      slug: 'homiio',
      version: VERSION,
      orientation: 'portrait',
      icon: './assets/images/mention-icon.png',
      scheme: 'homiio',
      userInterfaceStyle: 'automatic',
      newArchEnabled: true,
      jsEngine: 'hermes',
      // NOTE — `experiments.reactCompiler` is deliberately absent: the React
      // Compiler does not run in this app. Read `~/AGENTS.md` §"React Compiler +
      // external mutable state" before enabling it — with the compiler on,
      // READING external mutable state from a memoized position freezes the
      // first value forever. This app reads Reanimated shared values and
      // zustand stores in plenty of places.
      experiments: {
        // Expo's oxc transformer, about 2x faster cold bundles than Babel. Development
        // only: in a production export it keeps the requires of dead platform branches
        // (`if (Platform.OS !== 'web') require(...)`), pulling native-only packages into
        // the web bundle. The CLI sets NODE_ENV before it reads this config.
        noxcturnalTransformWorker: process.env.NODE_ENV !== 'production',
      },
      ios: {
        supportsTablet: true,
        bundleIdentifier: APP_ID,
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './assets/images/mention-icon_foreground.png',
          backgroundImage: './assets/images/mention-icon_background.png',
          monochromeImage: './assets/images/mention-icon_monochrome.png',
        },
        permissions: ['android.permission.CAMERA', 'android.permission.RECORD_AUDIO'],
        package: APP_ID,
        intentFilters: [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [
              {
                scheme: 'https',
                host: 'homiio.com',
              },
              {
                scheme: 'https',
                host: 'oxy.so',
              },
            ],
            category: ['BROWSABLE', 'DEFAULT'],
          },
          // The development variant also opens links to a local server. Its own
          // filter, without autoVerify: an http host can never verify, and in a
          // verified filter it would only fail it.
          ...(IS_DEV_VARIANT
            ? [
                {
                  action: 'VIEW',
                  data: [{ scheme: 'http', host: 'localhost', port: '4130' }],
                  category: ['BROWSABLE', 'DEFAULT'],
                },
              ]
            : []),
        ],
        softwareKeyboardLayoutMode: 'pan',
      },
      web: {
        bundler: 'metro',
        output: 'single',
        favicon: './assets/images/favicon.png',
        manifest: './public/manifest.json',
        meta: {
          viewport: 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no',
          themeColor: '#4F46E5',
          appleMobileWebAppCapable: 'yes',
          appleMobileWebAppStatusBarStyle: 'default',
          appleMobileWebAppTitle: 'Homiio',
          applicationName: 'Homiio',
          msapplicationTileColor: '#4F46E5',
          msapplicationConfig: '/browserconfig.xml',
        },
        build: {
          babel: {
            include: ['@expo/vector-icons'],
          },
        },
        // Add Metro configuration for better module resolution
        metro: {
          resolver: {
            alias: {
              '@react-native-async-storage/async-storage': require.resolve(
                '@react-native-async-storage/async-storage',
              ),
            },
          },
        },
      },
      plugins: [
        // SDK 58 turns async (lazy) routes on for web by default; Homiio keeps the
        // one-bundle web shape its size budget and cold-start check are measured on.
        ['expo-router', { asyncRoutes: { web: false } }],
        // Native OS splash (Oxy family "Instagram, from Meta" pattern): Homiio's
        // own logo (white on transparent) centered on the dark brand background,
        // with the shared Oxy symbol pinned to the bottom. `oxySplashScreenPlugin`
        // builds the expo-splash-screen tuple; the bare `@oxy.so/expo-splash` entry
        // (bundled Oxy asset) MUST follow it to add the bottom branding.
        oxySplashScreenPlugin({
          image: './assets/images/splash-logo.png',
          imageWidth: 176,
          backgroundColor: '#0B0B0F',
        }),
        '@oxy.so/expo-splash',
        [
          'expo-notifications',
          {
            color: '#ffffff',
          },
        ],
        [
          'expo-camera',
          {
            cameraPermission: 'Allow $(PRODUCT_NAME) to access your camera',
            // The one NSMicrophoneUsageDescription, naming the SDK's dictation
            // (recorded with expo-audio, transcribed by Alia) and voice calls.
            microphonePermission:
              'Allow $(PRODUCT_NAME) to access your microphone, including to dictate messages and to talk with Sindi and Alia',
            recordAudioAndroid: true,
          },
        ],
        'expo-image-picker',
        [
          // The SDK's voice call with Sindi or Alia captures and plays audio through
          // react-native-audio-api; the plugin declares RECORD_AUDIO. Its Info.plist mod would
          // overwrite the microphone usage string, so it is the one expo-camera above writes.
          'react-native-audio-api',
          {
            iosMicrophonePermission:
              'Allow $(PRODUCT_NAME) to access your microphone, including to dictate messages and to talk with Sindi and Alia',
            iosBackgroundMode: false,
            androidForegroundService: false,
            androidPermissions: ['android.permission.RECORD_AUDIO'],
          },
        ],
        [
          'expo-secure-store',
          {
            configureAndroidBackup: true,
            faceIDPermission: 'Allow $(PRODUCT_NAME) to access your Face ID biometric data.',
          },
        ],
        'react-native-compressor',
        [
          '@bitdrift/react-native',
          {
            networkInstrumentation: true,
          },
        ],
        [
          'expo-build-properties',
          {
            ios: {
              deploymentTarget: '16.4',
            },
            // No Android compileSdk / targetSdk / build tools: the Expo SDK
            // template sets them (SDK 58: 37 / 36 / 37.0.0). SDK 58's Expo
            // modules require compileSdk 37; a pinned 36 fails the release
            // build in :expo:checkReleaseAarMetadata.
          },
        ],
        // MapLibre Native for `@goway.to/maps` (not in Expo Go: a dev or store build).
        '@goway.to/maps',
        'expo-web-browser',
        'expo-image',
        'expo-localization',
        'expo-sharing',
        // Homiio runs on its own Android UID. It shares the Oxy identity and the
        // device session with Commons and Accounts over signature-protected IPC:
        // this declares and requests so.oxy.permission.IDENTITY and
        // DEVICE_SESSION and adds the <queries> for their providers.
        '@oxy.so/services/plugins/withOxySharedPermissions',
        // Every Oxy app MUST be release-signed with the one shared Oxy ecosystem
        // certificate: the signature permissions above are only granted to apps
        // signed like Commons. This replaces Expo's debug signing of the release
        // buildType with the OXY_UPLOAD_* Gradle properties (never in the repo;
        // debug fallback without them, so verify the artefact's certificate) and
        // swaps in proguard-android-optimize.txt.
        '@oxy.so/app-preset/plugin/withOxyAndroidRelease',
        // Points the Android home-screen widget (`modules/homiio-widgets`) at a
        // backend. The native module itself is autolinked from `modules/` — this
        // plugin only writes the two origin string resources, and only when a
        // build passes them. Production passes nothing and the module's own
        // `res/values/config.xml` defaults stand.
        './modules/homiio-widgets/app.plugin',
      ],
      extra: {
        eas: {
          projectId: 'a261857b-a404-45ce-983c-501242578074',
        },
        router: {
          origin: false,
        },
      },
      owner: 'oxyhq',
    },
  };
};
