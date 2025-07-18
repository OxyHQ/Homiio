# Homiio

Welcome to the Homiio repository — part of the Oxy ecosystem. Homiio is a platform for ethical housing, designed to help people find fair rentals, understand their rights, and connect with trustworthy landlords, all powered by AI and community-driven data.

## Overview

Homiio is built as a cross-platform mobile application using React Native (Expo) and a modular backend in Node.js with MongoDB. It integrates deeply with the Oxy ecosystem, including user authentication via `@oxyhq/services`, contract analysis through Sindi, and payment systems via OxyPay.

## Structure

```
homiio/
├── packages/
│   ├── frontend/            # React Native app (Expo)
│   └── backend/             # Node.js + Express backend API
├── .env.example             # Example environment variables
├── package.json             # Root workspace configuration
└── README.md                # This file
```

## Features

- 🔍 **Search rentals** with filters, keywords, and verified landlords
- 🧠 **AI assistant (Sindi)** for rights, legal doubts, and contract analysis
- 🏘️ **Tenant-landlord reviews** and reputation system
- 💸 **Rental payments with FairCoin** (via OxyPay, upcoming)
- 📎 **Contract upload and analysis** with summaries and alerts
- 📍 **Map view** with geolocated listings and insights by neighborhood
- 🔐 **Secure login** with session sync via `@oxyhq/services`

## Getting Started

### Prerequisites

- Node.js v18+
- npm v9+
- Expo CLI
- MongoDB instance (local or remote)

### Installation

```bash
git clone https://github.com/oxy-so/homiio.git
cd homiio
npm install
```

### Running Mobile App (Expo)

```bash
cd packages/frontend
npm start
```

### Running Backend API

```bash
cd packages/backend
npm run dev
```

### Environment Setup

1. Copy `.env.example` to `.env` in both `packages/frontend` and `packages/backend`
2. Fill in required values such as MongoDB URI, API base URL, etc.

## Scripts

Scripts available in the root `package.json`:

```json
{
  "dev": "concurrently \"npm run backend\" \"npm run frontend\"",
  "frontend": "cd packages/frontend && npm run start --tunnel --reset-cache",
  "backend": "cd packages/backend && npm run dev",
  "build": "npm run build --workspaces --if-present",
  "build:web": "cd packages/frontend && npm run build-web:prod",
  "build:web:dev": "cd packages/frontend && npm run build-web",
  "build:frontend": "cd packages/frontend && npm run build-web:prod",
  "build:backend": "cd packages/backend && npm run build",
  "lint": "npm run lint --workspaces --if-present",
  "lint:frontend": "cd packages/frontend && npm run lint",
  "lint:backend": "cd packages/backend && npm run lint",
  "install:all": "npm install && npm run install:frontend && npm run install:backend",
  "install:frontend": "cd packages/frontend && npm install",
  "install:backend": "cd packages/backend && npm install",
  "clean": "npm run clean --workspaces"
}
```

Run everything at once:
```bash
npm run dev         # Starts backend + mobile app (via concurrently)
```

Run individually:
```bash
npm run frontend
npm run backend
```

## Technologies Used

- **State Management**: Zustand
- **Frontend**: React Native (Expo), Tailwind via NativeWind, React Navigation
- **Backend**: Node.js, Express, MongoDB, JWT, Multer
- **Types/Validation**: TypeScript, Zod
- **i18n**: Built-in internationalization system
- **Auth**: `@oxyhq/services` (session + user system)
- **AI**: Integration with Sindi for AI-based legal help

## Contributing

We welcome contributions from ethical developers and activists who believe housing is a right. Please fork the repo, create a new branch, and submit a pull request.

For bugs or feature suggestions, open an issue.

## License

[AGPL-3.0](LICENSE)

---

Built with ❤️ by the Oxy team — creating ethical technology for a better world.

🌐 [https://oxy.so](https://oxy.so)  |  🏠 [https://homiio.com](https://homiio.com)
