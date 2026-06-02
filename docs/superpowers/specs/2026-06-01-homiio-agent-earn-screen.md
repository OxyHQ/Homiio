# Homiio — "Earn with Homiio" Agent screen + referral-link MVP

Date: 2026-06-01
Status: Approved-by-goal (config values tunable; payout deferred to Phase 2)

## Concept

Homiio lets **anyone act as a real estate agent**: a user ("Partner", marketed as
"Agent") brings a property owner to list on Homiio. When that property **rents,
sells, or exchanges**, the Partner earns a commission. This spec covers:

1. A polished, always-on **"Earn with Homiio" screen** (`/agent`), Airbnb-2026 style.
2. A **working referral-link MVP**: partner opt-in + unique link, property attribution
   via the link, an earnings ledger, and a partner dashboard.

Naming: **marketing copy says "Agent"**; the **product/data term is "Partner"**
(avoids implying a licensed *Agente de la Propiedad*). Routes/models/types use `partner`.

## Commission model (config constants — single source of truth)

Homiio is intentionally a **very low-fee platform**, so partner payouts are small
and **mostly flat** — a direct reward to the partner, not a share of a platform fee.

```ts
// packages/shared-types/src/partner.ts
export const COMMISSION_CONFIG = {
  currency: 'EUR',
  payout: {
    rent:     { kind: 'percentOfMonthlyRent', value: 0.03 },  // 3% of first month's rent
    sale:     { kind: 'flat',                 value: 150  },   // flat €150
    exchange: { kind: 'flat',                 value: 15   },   // flat €15
  },
} as const;
```

Worked examples: €1,200/mo rental → partner **€36**; any sale → partner **€150**;
any exchange → partner **€15**.

Payout trigger: **only when the deal closes** (no payout for merely listing → anti-spam).
Status flow: `pending` → `approved` (closed) → `paid` (**Phase 2**, no real money yet) / `cancelled`.

## Rewards & points (gamification)

Beyond cash, Partners earn **points** that unlock **tiered perks** (branded swag,
personalized business cards, badges). Points accrue on closed deals. MVP **tracks points +
tier and shows the perks**; **physical fulfillment (shipping a pen / printing cards) is
manual Phase 2** — no fulfillment pipeline now.

```ts
// packages/shared-types/src/partner.ts
export const POINTS_CONFIG = {
  perClosedDeal: 100,        // base points when a sourced deal closes
  perThousandEarned: 10,     // +10 points per €1,000 of partner payout
} as const;

export type RewardTierKey = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface RewardTier {
  key: RewardTierKey;
  minPoints: number;
  perkKeys: string[];        // i18n keys under agent.rewards.perks.*
}

export const REWARD_TIERS: RewardTier[] = [
  { key: 'bronze',   minPoints: 0,    perkKeys: ['profile'] },
  { key: 'silver',   minPoints: 300,  perkKeys: ['brandedPen', 'prioritySupport'] },
  { key: 'gold',     minPoints: 1000, perkKeys: ['businessCards', 'featuredBadge'] },
  { key: 'platinum', minPoints: 3000, perkKeys: ['swagBox', 'higherShare'] },
];

// highest tier whose minPoints <= points
export function tierForPoints(points: number): RewardTier { /* impl */ }
```

Accrual: in `commissionService.onPropertyTransacted`, after creating the Commission,
`partner.points += POINTS_CONFIG.perClosedDeal + Math.floor(amount / 1000) * POINTS_CONFIG.perThousandEarned`.
Tier is derived from points via `tierForPoints` (never stored) so both ends agree.
(With the low-fee payout model the per-1,000-earned bonus rarely triggers; the flat
per-closed-deal points are the main driver.)

## Shared types (`packages/shared-types/src/partner.ts`)

```ts
export type PartnerStatus = 'active' | 'inactive';

export interface Partner {
  id: string;
  userId: string;          // Oxy user id
  referralCode: string;    // unique short slug, e.g. "nate-7f3a"
  status: PartnerStatus;
  points: number;          // gamification points (see Rewards section)
  createdAt: string;
  updatedAt: string;
}

export type CommissionStatus = 'pending' | 'approved' | 'paid' | 'cancelled';
export type CommissionOffering = 'rent' | 'sale' | 'exchange';

export interface Commission {
  id: string;
  partnerId: string;
  propertyId: string;
  amount: number;          // partner payout, major units
  currency: string;        // ISO 4217
  basis: {
    offering: CommissionOffering;
    dealValue: number;     // monthly rent (rent) or sale price (sale); 0 for exchange
    kind: 'percentOfMonthlyRent' | 'flat';
    rate?: number;         // fraction of monthly rent, when kind is percentOfMonthlyRent
    flat?: number;         // flat reward (major units), when kind is flat
  };
  status: CommissionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PartnerStats {
  referredCount: number;   // properties sourced by this partner
  activeListings: number;
  pendingEarnings: number; // sum of pending + approved
  paidEarnings: number;
  currency: string;
}

export interface PartnerMeResponse {
  partner: Partner | null; // null until the user joins
  link: string | null;     // full referral link, null until joined
  stats: PartnerStats;
}
```

Property type (`packages/shared-types/src/property.ts`): add
`sourcedByPartner?: string` (Partner id) and `sourcedByReferralCode?: string` (audit).

## API contract (backend)

All partner routes require Oxy auth (follow existing auth middleware pattern).

- `POST /api/partners/join` — idempotent; create/activate Partner for current user, mint
  `referralCode` if absent → `PartnerMeResponse`.
- `GET  /api/partners/me` — `PartnerMeResponse` (`partner: null` if not joined).
- `GET  /api/partners/me/referrals` — `{ properties: Property[] }` sourced by me.
- `GET  /api/partners/me/earnings` — `{ commissions: Commission[] }`.
- Property create (`POST /api/properties`) — accept optional `referralCode`; resolve to
  partnerId; set `property.sourcedByPartner` + `sourcedByReferralCode`.
- Commission generation — when a property transitions to a closed/transacted state
  (rented/sold/exchanged), `commissionService.onPropertyTransacted(property)` creates one
  `Commission` (idempotent: skip if a commission for that property already exists, or if
  `sourcedByPartner` is unset). Hook the existing property status-change path; if none
  exists, add a guarded owner/admin endpoint `POST /api/properties/:id/mark-transacted`.

Referral link: `${WEB_BASE_URL}/properties/create?ref=<referralCode>` — reuse the existing
configured web base URL constant; do NOT hardcode. (Plus a convenience web route `/r/[code]`
that redirects to the create flow carrying `ref` — optional if time allows.)

## Frontend (`packages/frontend`)

Screen `app/agent/index.tsx` — **state-aware** (like Airbnb `/host`):
- Always: hero, how-it-works, earnings calculator, final CTA banner (marketing).
- If joined partner: also referral-link card + dashboard (referrals + earnings).
- If not joined: primary CTA "Start earning" → `POST /partners/join` then reveal link.
- If signed out: CTA prompts Oxy sign-in.

Components (`components/agent/`): `AgentHero`, `AgentHowItWorks`, `EarningsCalculator`
(interactive slider; computes from `COMMISSION_CONFIG`), `RewardsTeaser` (tiers + perks from
`REWARD_TIERS`, image/icon-forward), `ReferralLinkCard` (copy + native Share),
`PartnerDashboard` (referrals, earnings, **points + current tier + progress to next**),
`AgentCtaBanner` (reuse `HostCtaBanner` pattern).

Data: `hooks/usePartner.ts` — TanStack Query: `usePartnerMe`, `useJoinPartner` (mutation),
`useReferrals`, `useEarnings`. API client `services/partnerApi.ts`.

Referral capture: `store/referralStore.ts` (Zustand) persists a captured `ref`;
`app/properties/create.tsx` reads `ref` from route params → stores it → includes
`referralCode` on submit.

Entry points: an "Earn with Homiio" row in the profile/settings menu → `/agent`; an
`AgentCtaBanner` section on the home screen (`app/(tabs)/index.tsx`) — **in addition to**,
not replacing, the existing host CTA.

i18n: `agent.*` keys in `locales/en.json`, `es.json`, `ca-ES.json`, `it.json`.

### Calculator math (from `COMMISSION_CONFIG`)
- rent: `monthlyRent * payout.rent.value`  (= 3% of first month → €1,200/mo → €36)
- sale: `payout.sale.value`                (flat €150 — no slider, show flat note)
- exchange: `payout.exchange.value`        (flat €15 — no slider, show flat note)

### Canonical EN copy
- Hero title: "Anyone can be a real estate agent."
- Hero subtitle: "Bring a home to Homiio. When it rents or sells, you earn."
- CTA (not partner): "Start earning" · CTA (partner): "Share your link"
- How it works: ① "Find a home and its owner" — "Spot a great place: a friend's flat, a
  vacancy, anything." ② "They list it with your link" — "The owner publishes on Homiio
  through your referral." ③ "It rents or sells — you get paid" — "Earn a reward every time
  a home you brought rents or sells."
- Calculator: title "See what you could earn", labels "Monthly rent" / "Sale price",
  result "You earn".
- Referral card: "Your referral link" / "Copy" / "Share your link".
- Dashboard: "Your referrals" / "Pending" / "Earned" / "Listings" / "Points" / tier label.
- Rewards: title "Level up, get rewarded", subtitle "The more you bring in, the more you
  unlock." Perks (`agent.rewards.perks.*`): profile "Your Homiio agent profile", brandedPen
  "Homiio-branded pen", prioritySupport "Priority support", businessCards "Personalized
  business cards", featuredBadge "Featured agent badge", swagBox "Premium swag box",
  higherShare "Higher commission share". Tier labels: Bronze / Silver / Gold / Platinum.
- Final banner: "Start today. No license needed." — "Turn the homes around you into
  income." — CTA "Become an agent". Trust line: "No license needed. Work from your phone."

## Constraints (from CLAUDE.md)
Bun only. No `as any` / `@ts-ignore` / `!` / `console.log` / TODO. Avoid `useEffect` (derived
state / events / React Query). Bloom `yellow` theme (#ffc300), `colors.primaryForeground` on
primary fills (not white). Page roots use `colors.background` (#fcfcfc). NativeWind: no
function-form `Pressable` `style` (static array + onPressIn/Out state). Image-forward sections
(flat, per-section gutter). Image-forward empty states (PNG illustration, not generic icon).

## Scope boundary
Phase 1 (this pass): screen + link + attribution + earnings ledger + dashboard + **points/tier
tracking and rewards teaser**, all live.
Phase 2 (later): real payout rails (Stripe Connect) — the `paid` transition — and **physical
reward fulfillment** (shipping swag / printing business cards).
