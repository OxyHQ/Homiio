import { Request, Response } from 'express';
import { getOxyUserId } from '@oxyhq/core/server';
import config from '../config';
import {
  type CheckoutProduct,
  creditCheckoutSession,
  deactivateSubscriptionByStripeId,
  findBillingByOxyUserId,
  readEntitlements,
  recordSubscriptionPayment,
  updateBilling,
} from '../db/billing/billingRepository';
import type { billing } from '../db/schema';
import { getErrorMessage } from '../utils/errors';
import Stripe from 'stripe';

/** The products a Checkout session can carry, as the wire spells them. */
const CHECKOUT_PRODUCTS: readonly CheckoutProduct[] = ['plus', 'file', 'founder'];

/**
 * Narrow whatever the session metadata carries to a product this server sells.
 *
 * Stripe metadata is a free-form `string` map, so the value has to be checked
 * rather than asserted — and an unrecognised product must credit NOTHING rather
 * than fall into a default branch.
 */
function asCheckoutProduct(value: unknown): CheckoutProduct | null {
  return CHECKOUT_PRODUCTS.find((product) => product === value) ?? null;
}

/**
 * Stripe hands back either the subscription id or the expanded object depending
 * on what the caller asked to expand. `subscription['id']` on the string form is
 * an index into a string, which is why this narrows rather than casts.
 */
function subscriptionIdOf(
  subscription: string | Stripe.Subscription | null | undefined,
): string | undefined {
  if (!subscription) return undefined;
  return typeof subscription === 'string' ? subscription : subscription.id;
}

/**
 * The only columns the four subscription-state handlers may write.
 *
 * Named explicitly rather than `Partial<$inferInsert>`: manual cancel, sync,
 * Stripe cancel and reactivate all decide a subscription's state from Stripe,
 * and none has any business touching `file_credits`, `founder_supporter` or
 * `oxy_user_id`. A request body never reaches this type.
 *
 * `setPlusActive(…, {active: false})` is deliberately not used for any of them:
 * it also CLEARS `plus_stripe_subscription_id`, and sync and reactivate both
 * look the subscription up by that id afterwards.
 */
type SubscriptionStateColumns = Pick<
  Partial<typeof billing.$inferInsert>,
  'plusActive' | 'plusCanceledAt'
>;

/**
 * Apply a subscription-state decision and answer with the whole entitlements
 * object, or `null` when the account has no billing record — which is the 404
 * every one of these handlers returns.
 */
async function applySubscriptionState(oxyUserId: string, columns: SubscriptionStateColumns) {
  const updated = await updateBilling(oxyUserId, columns);
  if (!updated) return null;
  return readEntitlements(oxyUserId);
}

// Construct the client lazily, so an unconfigured deployment answers 501
// rather than throwing. Nothing here is required lazily — `stripe` is a static
// import at the top of this file and loads with the module either way; it is
// `new Stripe(key)` that must not run without a key.
function getStripe() {
  const key = config.stripe?.secretKey;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2024-06-20' });
}

function requireStripe(res: Response) {
  const stripe = getStripe();
  if (!stripe) {
    res.status(501).json({ success: false, error: { message: 'Stripe not configured', code: 'STRIPE_NOT_CONFIGURED' }});
    return null;
  }
  return stripe;
}

export async function createCheckoutSession(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return; // response already sent

    const { product } = (req.body || {}) as { product: 'plus' | 'file' | 'founder' };
    if (!product || !['plus', 'file', 'founder'].includes(product)) {
      return res.status(400).json({ success: false, error: { message: 'Invalid product', code: 'INVALID_PRODUCT' }});
    }

    const oxyUserId = getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    const priceId = product === 'plus' ? config.stripe?.pricePlus : config.stripe?.priceFile;
    const mode: 'subscription' | 'payment' = product === 'plus' ? 'subscription' : 'payment';

    // Support fallback when price IDs aren't configured: use price_data
    const lineItem: any = priceId
      ? { price: priceId, quantity: 1 }
      : product === 'plus'
        ? {
            price_data: {
              currency: 'eur',
              unit_amount: 999, // 9.99 €
              recurring: { interval: 'month' },
              product_data: { name: 'Homiio+ Subscription' },
            },
            quantity: 1,
          }
        : product === 'file'
          ? {
              price_data: {
                currency: 'eur',
                unit_amount: 500, // 5.00 €
                product_data: { name: 'Contract Review' },
            },
            quantity: 1,
          }
        : {
            price_data: {
                currency: 'eur',
                unit_amount: 1000, // 10.00 €
                recurring: { interval: 'month' },
                product_data: { name: 'Founder Supporter' },
            },
            quantity: 1,
          };

    const session = await stripe.checkout.sessions.create({
      mode,
      line_items: [lineItem],
      client_reference_id: String(oxyUserId), // Use Oxy user ID instead of profile ID
      metadata: {
        product,
        oxyUserId: String(oxyUserId),
      },
      success_url: config.stripe?.successUrl,
      cancel_url: config.stripe?.cancelUrl,
    });

    return res.json({ success: true, url: session.url, id: session.id });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || 'Failed to create checkout session' }});
  }
}

export async function stripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = config.stripe?.webhookSecret;
  const stripe = getStripe();

  if (!stripe) return res.status(501).json({ success: false, error: { message: 'Stripe not configured' }});
  if (!webhookSecret) return res.status(500).json({ success: false, error: { message: 'Webhook secret not configured' }});

  // Only use rawBody for signature verification — never fall back to parsed body
  const rawBody = req.rawBody;
  if (!rawBody) return res.status(400).json({ success: false, error: { message: 'Missing raw body for signature verification' }});

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const product = asCheckoutProduct(session.metadata?.product);
        const oxyUserId = session.client_reference_id || session.metadata?.oxyUserId;

        if (!oxyUserId || !product) {
          break;
        }

        // Idempotency is the `billing_processed_sessions` claim, taken in the
        // same transaction as the credit it authorises — see
        // `db/billing/billingRepository.ts`. The three per-product branches
        // Mongo needed (each opening with its own find-or-create) collapse into
        // one call, because the only thing that ever differed between them was
        // which columns the credit sets.
        const subscriptionId = subscriptionIdOf(session.subscription);
        await creditCheckoutSession({
          oxyUserId,
          sessionId: String(session.id),
          product,
          ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
        });
        break;
      }
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;

        // Only a subscription that is BOTH scheduled to end and already marked
        // cancelled by Stripe is acted on; anything else this event reports
        // (a plan change, a trial ending) is not a cancellation.
        if (sub.id && sub.cancel_at_period_end && sub.canceled_at) {
          await deactivateSubscriptionByStripeId(sub.id, new Date(sub.canceled_at * 1000));
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = subscriptionIdOf(invoice.subscription);

        if (subId) {
          await recordSubscriptionPayment(subId, new Date());
        }
        break;
      }
      case 'invoice.payment_failed':
      case 'customer.subscription.deleted': {
        // Both shapes reach here: a `Subscription` carries its own `id`, an
        // `Invoice` names the subscription it billed.
        const object = event.data.object as Stripe.Subscription | Stripe.Invoice;
        const subId =
          object.object === 'subscription' ? object.id : subscriptionIdOf(object.subscription);

        if (subId) {
          await deactivateSubscriptionByStripeId(subId, new Date());
        }
        break;
      }
      default:
        break;
    }
    return res.json({ received: true });
  } catch {
    return res.status(500).json({ error: 'Webhook handler failure' });
  }
}

export async function confirmCheckoutSession(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;
    const { session_id } = (req.body || {}) as { session_id?: string };
    if (!session_id) return res.status(400).json({ success: false, error: { message: 'Missing session_id' }});

    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    if (!session) return res.status(404).json({ success: false, error: { message: 'Session not found' }});

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return res.status(409).json({ success: false, error: { message: 'Session not completed' }});
    }

    const product = asCheckoutProduct(session.metadata?.product);
    const oxyUserId = session.client_reference_id || session.metadata?.oxyUserId;
    if (!product || !oxyUserId) return res.status(400).json({ success: false, error: { message: 'Missing product/oxyUserId in session' }});

    // The SAME claim the webhook takes, so a user landing on the success page
    // before Stripe's delivery arrives — or after it — is credited exactly once
    // either way. Under Mongo these were two independently written copies of one
    // guard; the session claim is now a single row and neither path can outrun
    // the other.
    const subscriptionId = subscriptionIdOf(session.subscription);
    await creditCheckoutSession({
      oxyUserId,
      sessionId: String(session.id),
      product,
      ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
    });

    // Verbatim from the Mongo handler: `file` deliberately answers with the
    // generic message rather than entitlements, while `plus` and `founder`
    // return them. The Mongo `plus` branch also re-read the record a second time
    // when the session had already been processed and answered with exactly the
    // same object — that read is gone, the response is not.
    if (product === 'file') {
      return res.json({ success: true, message: 'Session processed successfully' });
    }

    return res.json({ success: true, entitlements: await readEntitlements(oxyUserId) });
  } catch (error: any) {
    return res.status(500).json({ success: false, error: { message: error.message || 'Failed to confirm session' }});
  }
}

export async function testWebhookConfig(req: Request, res: Response) {
  try {
    const stripe = getStripe();
    const config = {
      hasStripe: !!stripe,
      hasSecretKey: !!process.env.STRIPE_SECRET_KEY,
      hasWebhookSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      hasPricePlus: !!process.env.STRIPE_PRICE_PLUS,
      hasPriceFile: !!process.env.STRIPE_PRICE_FILE,
      webhookUrl: `${process.env.API_URL || 'http://localhost:4130'}/api/billing/webhook`,
      successUrl: process.env.STRIPE_SUCCESS_URL || `${process.env.API_URL || 'http://localhost:4130'}/payments/success`,
      cancelUrl: process.env.STRIPE_CANCEL_URL || `${process.env.API_URL || 'http://localhost:4130'}/profile/subscriptions`
    };

    return res.json({ success: true, config });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: { message: err.message }});
  }
}

export async function debugBillingStatus(req: Request, res: Response) {
  try {
    const oxyUserId = getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find billing record for this user
    const entitlements = await readEntitlements(oxyUserId);
    if (!entitlements) {
      return res.status(404).json({ success: false, error: { message: 'Billing record not found', code: 'BILLING_NOT_FOUND' }});
    }

    // Get detailed billing information
    const billingInfo = {
      oxyUserId: entitlements.oxyUserId,
      billing: entitlements,
      hasBilling: true,
      plusActive: entitlements.plusActive,
      plusSince: entitlements.plusSince,
      plusStripeSubscriptionId: entitlements.plusStripeSubscriptionId,
      fileCredits: entitlements.fileCredits,
      lastPaymentAt: entitlements.lastPaymentAt,
      processedSessions: entitlements.processedSessions,
      processedSessionsCount: entitlements.processedSessions.length
    };

    return res.json({
      success: true,
      billing: billingInfo,
      message: billingInfo.plusActive ? 'Plus subscription is active' : 'Plus subscription is not active'
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: { message: err.message || 'Failed to get billing status' }});
  }
}

export async function debugSubscriptionStatus(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;

    const oxyUserId = req.user?.id || req.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find the billing record
    const billing = await findBillingByOxyUserId(oxyUserId);
    if (!billing) {
      return res.status(404).json({ success: false, error: { message: 'No billing record found' }});
    }

    interface SubscriptionDebugInfo {
      database: {
        oxyUserId: string;
        plusActive: boolean;
        plusStripeSubscriptionId?: string | null;
        plusCanceledAt?: Date | null;
        plusSince?: Date | null;
        lastPaymentAt?: Date | null;
      };
      stripe:
        | {
            id: string;
            status: string;
            cancel_at_period_end: boolean;
            canceled_at: number | null;
            current_period_end: number | null;
            created: number;
          }
        | { error: string }
        | null;
      comparison:
        | {
            databaseActive: boolean;
            stripeActive: boolean;
            stripeCanceled: boolean;
            needsSync: boolean;
            syncAction: string;
          }
        | { error: string }
        | null;
    }

    const debugInfo: SubscriptionDebugInfo = {
      database: {
        oxyUserId: billing.oxyUserId,
        plusActive: billing.plusActive,
        plusStripeSubscriptionId: billing.plusStripeSubscriptionId,
        plusCanceledAt: billing.plusCanceledAt,
        plusSince: billing.plusSince,
        lastPaymentAt: billing.lastPaymentAt
      },
      stripe: null,
      comparison: null
    };

    if (billing.plusStripeSubscriptionId) {
      try {
        const subscription = await stripe.subscriptions.retrieve(billing.plusStripeSubscriptionId);
        debugInfo.stripe = {
          id: subscription.id,
          status: subscription.status,
          cancel_at_period_end: subscription.cancel_at_period_end,
          canceled_at: subscription.canceled_at,
          current_period_end: subscription.current_period_end,
          created: subscription.created
        };

        // Compare database vs Stripe
        const dbActive = billing.plusActive;
        const stripeActive = subscription.status === 'active' && !subscription.cancel_at_period_end;
        const stripeCanceled = subscription.cancel_at_period_end || subscription.status === 'canceled';

        debugInfo.comparison = {
          databaseActive: dbActive,
          stripeActive: stripeActive,
          stripeCanceled: stripeCanceled,
          needsSync: (dbActive !== stripeActive) || (stripeCanceled && !billing.plusCanceledAt),
          syncAction: stripeCanceled ? 'mark_canceled' : stripeActive ? 'mark_active' : 'no_action'
        };
      } catch (stripeError) {
        debugInfo.stripe = { error: getErrorMessage(stripeError) };
        debugInfo.comparison = { error: 'Cannot compare - Stripe error' };
      }
    }

    return res.json({ success: true, debugInfo });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: {
        message: getErrorMessage(error) || 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    });
  }
}

export async function manuallyActivateSubscription(req: Request, res: Response) {
  try {
    const oxyUserId = getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    const { session_id, product = 'plus' } = req.body;
    if (!session_id) {
      return res.status(400).json({ success: false, error: { message: 'Missing session_id' }});
    }

    // `founder` is deliberately NOT accepted here, matching the Mongo handler:
    // this endpoint is the fallback for a Plus or file purchase whose webhook
    // never arrived, and it grants an entitlement without any Stripe evidence,
    // so its product list stays as narrow as it was.
    if (product !== 'plus' && product !== 'file') {
      return res.status(400).json({ success: false, error: { message: 'Invalid product type' }});
    }

    // The product is validated BEFORE the session is claimed, where Mongo
    // checked `processedSessions` first. The only case that answers differently
    // is an invalid product naming an ALREADY-SPENT session — 200 "already
    // activated" before, 400 "Invalid product type" now — and refusing a product
    // this server does not sell is the better of the two answers.
    const credited = await creditCheckoutSession({
      oxyUserId,
      sessionId: String(session_id),
      product,
    });
    const entitlements = await readEntitlements(oxyUserId);

    if (!credited) {
      return res.json({ success: true, entitlements, message: 'Subscription already activated' });
    }

    return res.json({
      success: true,
      entitlements,
      message:
        product === 'plus'
          ? 'Plus subscription activated successfully'
          : 'File credit added successfully',
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: { message: err.message || 'Failed to activate subscription' }});
  }
}

export async function createCustomerPortalSession(req: Request, res: Response) {
    try {
        const stripe = requireStripe(res);
        if (!stripe) return;

        const { subscriptionId } = req.body;
        const oxyUserId = getOxyUserId(req);

        if (!oxyUserId) {
            return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
        }

        if (!subscriptionId) {
            return res.status(400).json({ success: false, error: { message: 'Subscription ID required', code: 'SUBSCRIPTION_ID_REQUIRED' }});
        }

        // Find the billing record to get the subscription details
        const billing = await findBillingByOxyUserId(oxyUserId);
        if (!billing || !billing.plusStripeSubscriptionId) {
            return res.status(404).json({ success: false, error: { message: 'Subscription not found', code: 'SUBSCRIPTION_NOT_FOUND' }});
        }

        try {
            // Get the subscription to find the customer ID
            const subscription = await stripe.subscriptions.retrieve(billing.plusStripeSubscriptionId);
            const customerId = subscription.customer as string;

            // Create customer portal session
            const session = await stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: `${process.env.FRONTEND_URL || 'http://localhost:8130'}/profile/subscriptions`,
            });

            return res.json({ success: true, url: session.url });
        } catch (stripeError: any) {
            // Check if it's a configuration error
            if (stripeError.message && stripeError.message.includes('No configuration provided')) {
                return res.status(503).json({
                    success: false,
                    error: {
                        message: 'Customer portal not configured. Please contact support to manage your subscription.',
                        code: 'PORTAL_NOT_CONFIGURED'
                    }
                });
            }

            // For other Stripe errors, return a generic error
            return res.status(500).json({
                success: false,
                error: {
                    message: 'Unable to access subscription management. Please contact support.',
                    code: 'STRIPE_ERROR'
                }
            });
        }
    } catch {
        return res.status(500).json({
            success: false,
            error: {
                message: 'Internal server error',
                code: 'INTERNAL_ERROR'
            }
        });
    }
}

export async function manuallyCancelSubscription(req: Request, res: Response) {
  try {
    const oxyUserId = getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Mongo answered 404 on `modifiedCount === 0`, which meant "no record" and
    // nothing else — `plusCanceledAt` was set to a fresh `new Date()` on every
    // call, so a matched row always counted as modified. `RETURNING` on a
    // matched row says exactly the same thing without depending on that.
    const entitlements = await applySubscriptionState(oxyUserId, {
      plusActive: false,
      plusCanceledAt: new Date(),
    });

    if (!entitlements) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to cancel' }});
    }

    return res.json({ success: true, entitlements });
  } catch {
    return res.status(500).json({
      success: false,
      error: {
        message: 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    });
  }
}

export async function syncSubscriptionStatus(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;

    const oxyUserId = getOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find the billing record
    const billing = await findBillingByOxyUserId(oxyUserId);
    if (!billing) {
      return res.status(404).json({ success: false, error: { message: 'No billing record found' }});
    }

    if (!billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription ID found' }});
    }

    // Get current status from Stripe
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(billing.plusStripeSubscriptionId);
    } catch (stripeError: any) {
      return res.status(404).json({
        success: false,
        error: {
          message: `Subscription not found in Stripe: ${stripeError.message}`,
          code: 'SUBSCRIPTION_NOT_FOUND'
        }
      });
    }

    let updateData: SubscriptionStateColumns = {};

    // Update based on Stripe status
    if (subscription.cancel_at_period_end && subscription.canceled_at) {
      if (!billing.plusCanceledAt || billing.plusActive) {
        updateData = {
          plusActive: false,
          plusCanceledAt: new Date(subscription.canceled_at * 1000),
        };
      }
    } else if (subscription.status === 'active' && !subscription.cancel_at_period_end) {
      if (!billing.plusActive || billing.plusCanceledAt) {
        // `null`, not `undefined`. Mongoose STRIPS an `undefined` from a `$set`,
        // so this branch never actually cleared the cancellation — and its own
        // guard reads `|| billing.plusCanceledAt`, so it then re-fired on every
        // later sync and reported `statusChanged: true` forever for anyone who
        // had ever cancelled and come back. drizzle omits an `undefined` from
        // the SET clause too, so porting the spelling would have carried the
        // defect across invisibly.
        updateData = { plusActive: true, plusCanceledAt: null };
      }
    } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
      if (billing.plusActive || !billing.plusCanceledAt) {
        updateData = { plusActive: false, plusCanceledAt: new Date() };
      }
    }

    const statusChanged = Object.keys(updateData).length > 0;
    const entitlements = statusChanged
      ? await applySubscriptionState(oxyUserId, updateData)
      : await readEntitlements(oxyUserId);

    return res.json({
      success: true,
      entitlements,
      syncInfo: {
        stripeStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at,
        statusChanged,
        updateData
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Internal server error',
        code: 'INTERNAL_ERROR'
      }
    });
  }
}

export async function cancelSubscription(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;

    const { immediate = false } = req.body;
    const oxyUserId = getOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find the billing record to get the subscription ID
    const billing = await findBillingByOxyUserId(oxyUserId);
    if (!billing || !billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to cancel' }});
    }

    // Cancel the subscription in Stripe
    let canceledSubscription;

    if (immediate) {
      // Cancel immediately
      canceledSubscription = await stripe.subscriptions.cancel(billing.plusStripeSubscriptionId);
    } else {
      // Cancel at period end
      canceledSubscription = await stripe.subscriptions.update(billing.plusStripeSubscriptionId, {
        cancel_at_period_end: true
      });
    }

    // `canceled_at` is nullable on Stripe's type, and `null * 1000` is 0 — so
    // the previous arithmetic recorded 1 January 1970 as the cancellation date
    // whenever Stripe returned null. Fall back to now instead.
    const canceledAt = canceledSubscription.canceled_at
      ? new Date(canceledSubscription.canceled_at * 1000)
      : new Date();

    // Update the database to reflect the cancellation. Cancelling at period end
    // deliberately keeps `plusActive` true — the subscriber has paid through the
    // period — and only stamps when the cancellation was requested.
    const entitlements = await applySubscriptionState(oxyUserId, {
      ...(immediate ? { plusActive: false } : {}),
      plusCanceledAt: canceledAt,
    });

    return res.json({ success: true, entitlements });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to cancel subscription',
        code: 'CANCEL_ERROR'
      }
    });
  }
}

export async function reactivateSubscription(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;

    const oxyUserId = getOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find the billing record to get the subscription ID
    const billing = await findBillingByOxyUserId(oxyUserId);
    if (!billing || !billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to reactivate' }});
    }

    // Reactivate the subscription in Stripe
    await stripe.subscriptions.update(billing.plusStripeSubscriptionId, {
      cancel_at_period_end: false
    });

    // Update the database to reflect the reactivation. `null` CLEARS the
    // cancellation stamp — the Mongo spelling was `undefined`, which Mongoose
    // strips from a `$set`, so a reactivated subscriber kept a cancellation date
    // they no longer had. Same defect and same fix as `syncSubscriptionStatus`.
    const entitlements = await applySubscriptionState(oxyUserId, {
      plusActive: true,
      plusCanceledAt: null,
    });

    return res.json({ success: true, entitlements });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: {
        message: error.message || 'Failed to reactivate subscription',
        code: 'REACTIVATE_ERROR'
      }
    });
  }
}

export async function testWebhookEndpoint(req: Request, res: Response) {
  try {
    return res.json({
      success: true,
      message: 'Webhook endpoint is working',
      timestamp: new Date().toISOString(),
      headers: req.headers,
      body: req.body
    });
  } catch {
    return res.status(500).json({
      success: false,
      error: {
        message: 'Webhook test failed',
        code: 'WEBHOOK_TEST_ERROR'
      }
    });
  }
}

export default {
  createCheckoutSession,
  stripeWebhook,
  confirmCheckoutSession,
  testWebhookConfig,
  debugBillingStatus,
  manuallyActivateSubscription,
  createCustomerPortalSession,
  manuallyCancelSubscription,
  syncSubscriptionStatus,
  cancelSubscription,
  reactivateSubscription,
  testWebhookEndpoint,
  debugSubscriptionStatus,
};
