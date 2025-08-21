# Homiio App Tree Structure

```
Homiio/
├── .git/
├── .github/
├── .expo/
├── node_modules/
├── packages/
│   ├── frontend/                    # React Native/Expo frontend application
│   │   ├── app/                     # App router pages (Expo Router)
│   │   │   ├── _layout.tsx          # Root layout component
│   │   │   ├── index.tsx            # Home page
│   │   │   ├── notifications.tsx    # Notifications page
│   │   │   ├── +not-found.tsx       # 404 page
│   │   │   ├── profile/             # User profile pages
│   │   │   ├── payments/            # Payment/pricing pages
│   │   │   ├── sindi/               # AI assistant pages
│   │   │   ├── saved/               # Saved items pages
│   │   │   ├── properties/          # Property listing pages
│   │   │   ├── settings/            # App settings pages
│   │   │   ├── search/              # Search functionality pages
│   │   │   ├── viewings/            # Property viewing pages
│   │   │   ├── insights/            # Analytics/insights pages
│   │   │   ├── roommates/           # Roommate matching pages
│   │   │   ├── tips/                # Tips/advice pages
│   │   │   ├── contracts/           # Contract management pages
│   │   │   └── horizon/             # Horizon feature pages
│   │   ├── components/              # Reusable UI components
│   │   ├── store/                   # Zustand state management
│   │   │   ├── store.ts             # Main store configuration
│   │   │   ├── appStore.ts          # App-level state
│   │   │   ├── profileStore.ts      # User profile state
│   │   │   ├── propertyStore.ts     # Property data state
│   │   │   ├── propertyListStore.ts # Property listings state
│   │   │   ├── roommateStore.ts     # Roommate matching state
│   │   │   ├── conversationStore.ts # Chat/conversation state
│   │   │   ├── subscriptionStore.ts # Subscription/billing state
│   │   │   ├── favoritesStore.ts    # Favorites state
│   │   │   ├── savedPropertiesStore.ts
│   │   │   ├── savedProfilesStore.ts
│   │   │   ├── savedSearchesStore.ts
│   │   │   ├── recentlyViewedStore.ts
│   │   │   ├── createPropertyFormStore.ts
│   │   │   ├── trustScoreStore.ts   # Trust score state
│   │   │   ├── trendsStore.ts       # Market trends state
│   │   │   ├── searchStatisticsStore.ts
│   │   │   ├── roomStore.ts         # Room data state
│   │   │   ├── locationStore.ts     # Location data state
│   │   │   ├── neighborhoodStore.ts # Neighborhood data state
│   │   │   ├── leaseStore.ts        # Lease data state
│   │   │   ├── currencyStore.ts     # Currency conversion state
│   │   │   ├── bottomSheetStore.ts  # Bottom sheet state
│   │   │   └── analyticsStore.ts    # Analytics state
│   │   ├── services/                # API services and utilities
│   │   ├── hooks/                   # Custom React hooks
│   │   ├── utils/                   # Utility functions
│   │   ├── types/                   # TypeScript type definitions
│   │   ├── context/                 # React context providers
│   │   ├── constants/               # App constants
│   │   ├── assets/                  # Static assets (images, fonts)
│   │   ├── styles/                  # Global styles
│   │   ├── locales/                 # Internationalization files
│   │   ├── lib/                     # Third-party library configurations
│   │   ├── public/                  # Public assets
│   │   ├── docs/                    # Documentation
│   │   ├── scripts/                 # Build/deployment scripts
│   │   ├── ios/                     # iOS native code
│   │   │   └── Homiio/
│   │   │       ├── Images.xcassets/ # iOS app icons and images
│   │   │       └── Supporting/      # iOS supporting files
│   │   ├── android/                 # Android native code
│   │   │   └── app/
│   │   │       └── src/
│   │   │           └── main/
│   │   │               ├── java/    # Android Java code
│   │   │               ├── res/     # Android resources
│   │   │               └── assets/  # Android assets
│   │   ├── config.ts                # Frontend configuration
│   │   ├── app.config.js            # Expo app configuration
│   │   ├── package.json             # Frontend dependencies
│   │   ├── tsconfig.json            # TypeScript configuration
│   │   ├── tailwind.config.js       # Tailwind CSS configuration
│   │   ├── metro.config.js          # Metro bundler configuration
│   │   ├── babel.config.js          # Babel configuration
│   │   ├── eslint.config.js         # ESLint configuration
│   │   ├── jest.config.js           # Jest testing configuration
│   │   ├── postcss.config.js        # PostCSS configuration
│   │   ├── prettier.config.js       # Prettier configuration
│   │   ├── global.css               # Global CSS styles
│   │   ├── vercel.json              # Vercel deployment config
│   │   ├── README.md                # Frontend documentation
│   │   ├── PERFORMANCE_OPTIMIZATION.md
│   │   ├── FOLDER_FUNCTIONALITY.md
│   │   └── nativewind-env.d.ts      # NativeWind type definitions
│   ├── backend/                     # Node.js/Express backend API
│   │   ├── routes/                  # API route definitions
│   │   │   ├── index.ts             # Main routes index
│   │   │   ├── profiles.ts          # Profile management routes
│   │   │   ├── properties.ts        # Property management routes
│   │   │   ├── billing.ts           # Billing/payment routes
│   │   │   ├── ai.ts                # AI/chat routes
│   │   │   ├── public.ts            # Public API routes
│   │   │   ├── images.ts            # Image handling routes
│   │   │   ├── viewings.ts          # Property viewing routes
│   │   │   ├── analytics.ts         # Analytics routes
│   │   │   ├── telegram.ts          # Telegram integration routes
│   │   │   ├── test.ts              # Testing routes
│   │   │   ├── tips.ts              # Tips/advice routes
│   │   │   ├── rooms.ts             # Room management routes
│   │   │   ├── notifications.ts     # Notification routes
│   │   │   ├── leases.ts            # Lease management routes
│   │   │   ├── cities.ts            # City/location routes
│   │   │   ├── devices.ts           # Device management routes
│   │   │   └── roommates.ts         # Roommate matching routes
│   │   ├── controllers/             # Route controllers
│   │   │   ├── index.ts             # Controllers index
│   │   │   ├── profileController.ts # Profile management logic
│   │   │   ├── propertyController.ts # Property management logic
│   │   │   ├── billingController.ts # Billing/payment logic
│   │   │   ├── imageController.ts   # Image handling logic
│   │   │   ├── viewingController.ts # Property viewing logic
│   │   │   ├── roommateController.ts # Roommate matching logic
│   │   │   ├── analyticsController.ts # Analytics logic
│   │   │   ├── telegramController.ts # Telegram integration logic
│   │   │   ├── tipsController.ts    # Tips/advice logic
│   │   │   ├── roomController.ts    # Room management logic
│   │   │   ├── cityController.ts    # City/location logic
│   │   │   ├── deviceController.ts  # Device management logic
│   │   │   ├── leaseController.ts   # Lease management logic
│   │   │   └── notificationController.ts # Notification logic
│   │   ├── models/                  # Database models
│   │   │   ├── index.ts             # Models index
│   │   │   └── schemas/             # Database schemas
│   │   │       ├── ProfileSchema.ts # User profile schema
│   │   │       ├── PropertySchema.ts # Property schema
│   │   │       ├── ConversationSchema.ts # Chat schema
│   │   │       ├── BillingSchema.ts # Billing schema
│   │   │       ├── LeaseSchema.ts   # Lease schema
│   │   │       ├── RoomSchema.ts    # Room schema
│   │   │       ├── CitySchema.ts    # City schema
│   │   │       ├── EnergyDataSchema.ts # Energy data schema
│   │   │       ├── SavedSchema.ts   # Saved items schema
│   │   │       ├── SavedPropertyFolderSchema.ts
│   │   │       ├── SavedSearchSchema.ts
│   │   │       ├── RecentlyViewedSchema.ts
│   │   │       └── ViewingRequestSchema.ts
│   │   ├── services/                # Business logic services
│   │   ├── middlewares/             # Express middlewares
│   │   ├── utils/                   # Utility functions
│   │   ├── database/                # Database configuration
│   │   ├── migrations/              # Database migrations
│   │   ├── types/                   # TypeScript type definitions
│   │   ├── docs/                    # API documentation
│   │   ├── test/                    # Test files
│   │   ├── logs/                    # Application logs
│   │   ├── packages/                # Additional packages
│   │   ├── locales/                 # Internationalization
│   │   ├── scripts/                 # Build/deployment scripts
│   │   ├── node_modules/            # Backend dependencies
│   │   ├── dist/                    # Compiled backend code
│   │   ├── server.ts                # Main server file
│   │   ├── config.ts                # Backend configuration
│   │   ├── package.json             # Backend dependencies
│   │   ├── tsconfig.json            # TypeScript configuration
│   │   ├── eslint.config.js         # ESLint configuration
│   │   ├── vercel.json              # Vercel deployment config
│   │   └── README.md                # Backend documentation
│   ├── shared-types/                # Shared TypeScript types
│   │   ├── src/                     # Type definitions source
│   │   ├── dist/                    # Compiled types
│   │   ├── node_modules/            # Dependencies
│   │   ├── package.json             # Package configuration
│   │   ├── tsconfig.json            # TypeScript configuration
│   │   ├── eslint.config.js         # ESLint configuration
│   │   └── README.md                # Documentation
│   └── config/                      # Shared configuration (empty)
├── scripts/                         # Root-level scripts
├── node_modules/                    # Root dependencies
├── package.json                     # Root package configuration
├── package-lock.json                # Dependency lock file
├── tsconfig.json                    # Root TypeScript configuration
├── tailwind.config.js               # Root Tailwind configuration
├── postcss.config.js                # Root PostCSS configuration
├── .npmrc                           # NPM configuration
├── .prettierignore                  # Prettier ignore rules
├── .gitignore                       # Git ignore rules
├── vercel.json                      # Root Vercel deployment config
├── README.md                        # Project documentation
├── STRIPE_SUBSCRIPTION_DEBUG.md     # Stripe debugging guide
└── VERCEL_DEPLOYMENT.md             # Deployment documentation
```

## Key Technologies & Architecture

### Frontend (React Native/Expo)
- **Framework**: Expo Router for navigation
- **State Management**: Zustand (multiple stores for different domains)
- **Styling**: Tailwind CSS with NativeWind
- **Data Fetching**: @tanstack/react-query
- **Platforms**: iOS, Android, Web

### Backend (Node.js/Express)
- **Framework**: Express.js
- **Database**: MongoDB with Mongoose schemas
- **Architecture**: MVC pattern with controllers and services
- **API**: RESTful endpoints organized by domain

### Shared
- **TypeScript**: Full type safety across frontend and backend
- **Monorepo**: Lerna/Yarn workspaces structure
- **Deployment**: Vercel for both frontend and backend

### Key Features
- Property search and management
- Roommate matching
- AI-powered chat assistant (Sindi)
- User profiles and trust scoring
- Property viewings and bookings
- Subscription billing
- Analytics and insights
- Multi-language support
- Push notifications
- Telegram integration
