<a href="https://homiio.com/" target="_blank" rel="noopener">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="" />
    <img alt="Homiio" src="" />
  </picture>
</a>

<div align="center">
  <h1>Homiio (Frontend)</h1>
  <h3>Homiio client<br />built with React Native and Expo</h3>
  
  <br />
  <figure>
    <img src="https://raw.githubusercontent.com/OxyHQ/Homiio/refs/heads/master/assets/images/HomiioBanner.png" alt="Homiio" />
  </figure>
</div>

<div align="center">
  <img src="https://img.shields.io/github/stars/OxyHQ/Homiio?style=flat" height="20">
  <img src="https://img.shields.io/github/commit-activity/m/OxyHQ/Homiio" height="20">
  <img src="https://img.shields.io/github/deployments/OxyHQ/Homiio/Production?label=vercel&logo=vercel&logoColor=white" height="20">
  <a href="https://twitter.com/OxyHQ?ref_src=twsrc%5Etfw" target="_blank"><img src="https://img.shields.io/twitter/follow/OxyHQ?style=social" height="20"></a>
</div>

<br />

## Overview

Homiio is an ethical and transparent rental platform built with React Native and Expo. It facilitates fair rental agreements, ensuring reliability and security for both landlords and tenants. The platform integrates essential features such as property management, user verification, secure payments, and real-time property monitoring.

## Features

Homiio users can:

- 🏡 List and browse rental properties.
- ✅ Verify identity as landlords or tenants.
- 🌟 Leave and view ratings/reviews for landlords and tenants.
- ⚖️ Maintain a trust-based **karma system** for ethical rentals.
- 💰 Process **secure payments**, including transactions via **FairCoin**.
- 🔍 Detect fraudulent listings with built-in security alerts.
- 📜 Manage rental contracts and documentation verification.
- 🔄 Match rental options based on user preferences.
- 💵 Handle deposits through an integrated deposit management system.
- 🏅 Get eco-certification for sustainable properties.
- 📊 Monitor real-time energy consumption via a **Raspberry Pi device** connected to Homiio’s APIs.
- 👥 Join community forums for discussions and support.
- 🏘️ Find compatible roommates via a co-living search feature.
- 🌍 Access **Horizon**, Oxy's ecosystem for ethical communities, with additional benefits.

## Tech Stack

- React Native / Expo
- TypeScript
- TailwindCSS (via NativeWind)
- Redux for state management
- React Navigation

## Installation

1. Clone the repository:
```bash
  git clone https://github.com/OxyHQ/Homiio.git
```

2. Install dependencies:
```bash
  yarn install
```

3. Start the development server:
```bash
  yarn start
```

4. Run on specific platforms:
```bash
# For iOS
yarn ios

# For Android
yarn android

# For Web
yarn web
```

## Project Structure

```
frontend/
├── app/                 # App screens and navigation
├── assets/              # Static assets (images, fonts, icons)
├── components/          # Reusable UI components
├── constants/           # App-wide constants
├── context/             # React Context providers
├── features/            # Feature-specific components and logic
├── hooks/               # Custom React hooks
├── interfaces/          # TypeScript interfaces
├── lib/                 # Third-party library configurations
├── store/               # Redux store configuration
├── styles/              # Global styles and themes
├── utils/               # Utility functions and helpers
└── types/               # Global TypeScript type definitions
```

## Contributing

1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a new Pull Request

## Troubleshooting

### Common Issues

1. Metro bundler issues
```bash
yarn start --clear
```

2. Dependencies issues
```bash
rm -rf node_modules
yarn install
