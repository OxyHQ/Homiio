export interface Entitlements {
  plusActive: boolean;
  plusSince?: string;
  plusCanceledAt?: string;
  plusStripeSubscriptionId?: string;
  fileCredits: number;
  lastPaymentAt?: string;
  founderSupporter: boolean;
  founderSince?: string;
  processedSessions: string[];
}
