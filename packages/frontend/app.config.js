const pkg = require('./package.json')

module.exports = function(config) {
    
    /**
     * App version number. Should be incremented as part of a release cycle.
     */
  const VERSION = pkg.version

  /**
   * Uses built-in Expo env vars
   *
   * @see https://docs.expo.dev/build-reference/variables/#built-in-environment-variables
   */
  const PLATFORM = process.env.EAS_BUILD_PLATFORM

  const IS_TESTFLIGHT = process.env.EXPO_PUBLIC_ENV === 'testflight'
  const IS_PRODUCTION = process.env.EXPO_PUBLIC_ENV === 'production'
  const IS_DEV = !IS_TESTFLIGHT || !IS_PRODUCTION


return {
    expo: {
        name: "Homiio",
        slug: "homiio",
        version: VERSION,
        orientation: "portrait",
        icon: "./assets/images/mention-icon.png",
        scheme: "mention",
        userInterfaceStyle: "automatic",
        newArchEnabled: true,
        ios: {
            supportsTablet: true,
            bundleIdentifier: "earth.mention.android"
        },
        android: {
            adaptiveIcon: {
                foregroundImage: "./assets/images/mention-icon_foreground.png",
                backgroundImage: "./assets/images/mention-icon_background.png",
                monochromeImage: "./assets/images/mention-icon_monochrome.png"
            },
            permissions: [
                "android.permission.CAMERA",
                "android.permission.RECORD_AUDIO"
            ],
            package: "earth.mention.android",
            intentFilters: [
                    {
                        action: 'VIEW',
                        autoVerify: true,
                        data: [
                            {
                                scheme: 'https',
                                host: 'mention.earth',
                            },
                            IS_DEV && {
                                scheme: 'http',
                                host: 'localhost:3001',
                            },
                            {
                                scheme: 'https',
                                host: 'oxy.so',
                            },
                            IS_DEV && {
                                scheme: 'http',
                                host: 'localhost:3000',
                            },
                        ],
                        category: ['BROWSABLE', 'DEFAULT'],
                    },
                ],
        },
        web: {
            bundler: "metro",
            output: "static",
            favicon: "./assets/images/favicon.png",
            manifest: "./public/manifest.json",
            meta: {
                // Basic SEO
                viewport: "width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
                description: "Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.",
                keywords: "housing, rental, property, ethical housing, transparent rentals, verified properties, fair agreements",
                author: "Homiio",
                robots: "index, follow",
                
                // Theme and branding
                themeColor: "#4F46E5",
                msapplicationTileColor: "#4F46E5",
                msapplicationConfig: "/browserconfig.xml",
                
                // Apple specific
                appleMobileWebAppCapable: "yes",
                appleMobileWebAppStatusBarStyle: "default",
                appleMobileWebAppTitle: "Homiio",
                applicationName: "Homiio",
                formatDetection: "telephone=no",
                
                // Open Graph (Facebook, LinkedIn, WhatsApp, Telegram)
                "og:title": "Homiio - Ethical Housing Platform",
                "og:description": "Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.",
                "og:type": "website",
                "og:image": "/assets/images/og-image.png",
                "og:image:width": "1200",
                "og:image:height": "630",
                "og:image:alt": "Homiio - Ethical Housing Platform",
                "og:image:type": "image/png",
                "og:image:secure_url": "/assets/images/og-image.png",
                "og:url": "https://homiio.com",
                "og:site_name": "Homiio",
                "og:locale": "en_US",
                
                // Twitter Card
                "twitter:card": "summary_large_image",
                "twitter:title": "Homiio - Ethical Housing Platform",
                "twitter:description": "Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.",
                "twitter:image": "/assets/images/og-image.png",
                "twitter:image:alt": "Homiio - Ethical Housing Platform",
                "twitter:site": "@homiio",
                "twitter:creator": "@homiio",
                
                // Additional social networks
                "pinterest-rich-pin": "true",
                
                // Schema.org structured data
                "application-name": "Homiio",
            },
            build: {
                babel: {
                    include: ["@expo/vector-icons"]
                }
            }
        },
        plugins: [
            [
                "expo-splash-screen",
                {
                    image: "./assets/images/splash-icon.png",
                    imageWidth: 200,
                    resizeMode: "contain",
                    backgroundColor: "#ffffff"
                }
            ],
            [
                "expo-notifications",
                {
                    color: "#ffffff"
                }
            ],
            [
                "expo-camera",
                {
                    cameraPermission: "Allow $(PRODUCT_NAME) to access your camera",
                    microphonePermission: "Allow $(PRODUCT_NAME) to access your microphone",
                    recordAudioAndroid: true
                }
            ],
            "expo-image-picker",
            [
                "expo-secure-store",
                {
                    configureAndroidBackup: true,
                    faceIDPermission: "Allow $(PRODUCT_NAME) to access your Face ID biometric data."
                }
            ],
            [
                'expo-font',
                {
                  fonts: [
                    './assets/fonts/inter/InterVariable.woff2',
                    './assets/fonts/inter/InterVariable-Italic.woff2',
                    // Android only
                    './assets/fonts/inter/Inter-Regular.otf',
                    './assets/fonts/inter/Inter-Italic.otf',
                    './assets/fonts/inter/Inter-SemiBold.otf',
                    './assets/fonts/inter/Inter-SemiBoldItalic.otf',
                    './assets/fonts/inter/Inter-ExtraBold.otf',
                    './assets/fonts/inter/Inter-ExtraBoldItalic.otf',
                    './assets/fonts/Phudu-VariableFont_wght.ttf',
                  ],
                },
              ],
            'react-native-compressor',
            [
                '@bitdrift/react-native',
                {
                    networkInstrumentation: true,
                }
            ],
            [
                'expo-build-properties',
                {
                  ios: {
                    deploymentTarget: '15.1',
                  },
                  android: {
                    compileSdkVersion: 35,
                    targetSdkVersion: 35,
                    buildToolsVersion: '35.0.0',
                  },
                },
            ],
            "expo-router",
    "expo-web-browser",
        ],
        extra: {
            eas: {
                projectId: "0ca1d394-efea-4bf7-91b6-ed94a021bcf3"
            },
            router: {
                origin: false
            }
        },
        owner: "nateisern"
    }
};
};
