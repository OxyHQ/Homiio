import { createCheckoutSession, stripeWebhook, confirmCheckoutSession, testWebhookConfig, debugBillingStatus, manuallyActivateSubscription, createCustomerPortalSession, manuallyCancelSubscription, syncSubscriptionStatus, cancelSubscription, reactivateSubscription, testWebhookEndpoint, debugSubscriptionStatus } from '../controllers/billingController';
import express from 'express';
import performanceMonitor from '../middlewares/performance';

export default function() {
  const router = express.Router();

  router.use(performanceMonitor);

  // Stripe webhook (public, must accept raw body)
  // We'll mount this route at /api/billing/webhook in server.ts with raw body parser
  router.post('/webhook', stripeWebhook);

  // Test endpoint to check webhook configuration
  router.get('/webhook-test', testWebhookConfig);

  // Debug endpoint to check billing status
  router.get('/debug-billing', debugBillingStatus);

  // Manual activation endpoint (fallback for when webhooks fail)
  router.post('/manual-activate', manuallyActivateSubscription);

  // Manual cancellation endpoint (requires auth)
  router.post('/manual-cancel', manuallyCancelSubscription);

  // Sync subscription status from Stripe (requires auth)
  router.post('/sync-subscription', syncSubscriptionStatus);

  // Cancel subscription (requires auth)
  router.post('/cancel-subscription', cancelSubscription);

  // Reactivate subscription (requires auth)
  router.post('/reactivate-subscription', reactivateSubscription);

  // Webhook test endpoint (no auth required)
  router.post('/webhook-test-endpoint', testWebhookEndpoint);

  // Debug subscription status (requires auth)
  router.get('/debug-subscription', debugSubscriptionStatus);

  // Checkout session creation (requires auth)
  router.post('/checkout', createCheckoutSession);

  // Customer portal session creation (requires auth)
  router.post('/customer-portal', createCustomerPortalSession);

  return router;
}
