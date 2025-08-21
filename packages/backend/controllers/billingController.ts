import { Request, Response } from 'express';
import config from '../config';
const { Profile, Billing } = require('../models');

// Lazy require Stripe to avoid hard crash if not configured
function getStripe() {
  const key = config.stripe?.secretKey;
  if (!key) return null;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Stripe = require('stripe');
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

    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
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
    console.error('Stripe checkout session error:', error);
    return res.status(500).json({ success: false, error: { message: error.message || 'Failed to create checkout session' }});
  }
}

export async function stripeWebhook(req: Request, res: Response) {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = config.stripe?.webhookSecret;
  const stripe = getStripe();
  
  console.log('🔔 Stripe webhook received:', {
    hasSignature: !!sig,
    hasWebhookSecret: !!webhookSecret,
    hasStripe: !!stripe,
    contentType: req.headers['content-type'],
    hasRawBody: !!(req as any).rawBody || !!(req as any).bodyRaw || !!(req as any).body
  });
  
  if (!stripe) return res.status(501).json({ success: false, error: { message: 'Stripe not configured' }});
  if (!webhookSecret) return res.status(500).json({ success: false, error: { message: 'Webhook secret not configured' }});

  let event;
  try {
    // raw body is required; ensure server.ts skips JSON parsing for this route
    event = stripe.webhooks.constructEvent((req as any).rawBody || (req as any).bodyRaw || (req as any).body, sig, webhookSecret);
    console.log('✅ Webhook signature verified, event type:', event.type);
  } catch (err: any) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    console.log('🔔 Processing webhook event:', event.type);
    
    switch (event.type) {
      case 'checkout.session.completed': {
        const session: any = event.data.object;
        const product = session.metadata?.product;
        const oxyUserId = session.client_reference_id || session.metadata?.oxyUserId;
        
        console.log('💰 Checkout session completed:', {
          sessionId: session.id,
          product,
          oxyUserId,
          paymentStatus: session.payment_status,
          status: session.status,
          subscriptionId: session.subscription
        });
        
        if (!oxyUserId) {
          console.error('❌ No oxyUserId found in session:', session);
          break;
        }
        
        // Idempotent update using processedSessions guard
        const sessionId = String(session.id);
        
        if (product === 'file') {
          console.log('📄 Processing file credit purchase for user:', oxyUserId);
          
          // Ensure billing record exists
          let billing = await Billing.findOne({ oxyUserId });
          if (!billing) {
            console.log('📝 Creating billing record for user:', oxyUserId);
            billing = new Billing({
              oxyUserId,
              plusActive: false,
              fileCredits: 0,
              processedSessions: []
            });
            await billing.save();
          }
          
          const result = await Billing.updateOne(
            { oxyUserId, 'processedSessions': { $ne: sessionId } },
            { 
              $set: { 
                'lastPaymentAt': new Date(),
              }, 
              $inc: { 'fileCredits': 1 }, 
              $addToSet: { 'processedSessions': sessionId }
            }
          );
          console.log('📄 File credit update result:', result);
        } else if (product === 'plus') {
          console.log('⭐ Processing Plus subscription for user:', oxyUserId);
          
          // Ensure billing record exists
          let billing = await Billing.findOne({ oxyUserId });
          if (!billing) {
            console.log('📝 Creating billing record for user:', oxyUserId);
            billing = new Billing({
              oxyUserId,
              plusActive: false,
              fileCredits: 0,
              processedSessions: []
            });
            await billing.save();
          }
          
          const setUpdate: any = { 
            'lastPaymentAt': new Date(), 
            'plusActive': true, 
            'plusSince': new Date() 
          };
          
          if (session.subscription) {
            setUpdate['plusStripeSubscriptionId'] = String(session.subscription);
          }
          
          const result = await Billing.updateOne(
            { oxyUserId, 'processedSessions': { $ne: sessionId } },
            { 
              $set: setUpdate, 
              $addToSet: { 'processedSessions': sessionId }
            }
          );
          console.log('⭐ Plus subscription update result:', result);
          
          // Verify the update worked
          const updatedProfile = await Billing.findOne({ oxyUserId }).lean();
          console.log('✅ Profile billing after update:', updatedProfile);
          
          if (result.modifiedCount === 0) {
            console.warn('⚠️ No documents were modified. Session may have been processed already.');
          }
        } else if (product === 'founder') {
          console.log('💝 Processing Founder supporter for user:', oxyUserId);
          
          // Ensure billing record exists
          let billing = await Billing.findOne({ oxyUserId });
          if (!billing) {
            console.log('📝 Creating billing record for user:', oxyUserId);
            billing = new Billing({
              oxyUserId,
              plusActive: false,
              fileCredits: 0,
              processedSessions: []
            });
            await billing.save();
          }
          
          const result = await Billing.updateOne(
            { oxyUserId, 'processedSessions': { $ne: sessionId } },
            { 
              $set: { 
                'lastPaymentAt': new Date(),
                'founderSupporter': true,
                'founderSince': new Date()
              }, 
              $addToSet: { 'processedSessions': sessionId }
            }
          );
          console.log('💝 Founder supporter update result:', result);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub: any = event.data.object;
        const subId = sub.id;
        console.log('📝 Subscription updated:', subId, 'cancel_at_period_end:', sub.cancel_at_period_end);
        
        if (subId) {
          const updateData: any = {};
          
          // If subscription is set to cancel at period end, mark it as canceled
          if (sub.cancel_at_period_end && sub.canceled_at) {
            updateData.plusActive = false;
            updateData.plusCanceledAt = new Date(sub.canceled_at * 1000); // Convert timestamp to Date
            console.log('❌ Marking subscription as canceled at period end:', subId);
          }
          
          if (Object.keys(updateData).length > 0) {
            const result = await Billing.updateMany(
              { 'plusStripeSubscriptionId': subId }, 
              { $set: updateData }
            );
            console.log('📝 Subscription update result:', result);
          }
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice: any = event.data.object;
        const subId = invoice.subscription;
        console.log('✅ Payment succeeded for subscription:', subId);
        
        if (subId) {
          // Update last payment date for active subscriptions
          const result = await Billing.updateMany(
            { 'plusStripeSubscriptionId': subId, 'plusActive': true }, 
            { $set: { 'lastPaymentAt': new Date() } }
          );
          console.log('✅ Payment update result:', result);
        }
        break;
      }
      case 'invoice.payment_failed':
      case 'customer.subscription.deleted': {
        const sub: any = event.data.object;
        const subId = sub.id || sub.subscription;
        console.log('❌ Subscription cancelled/failed:', subId);
        
        if (subId) {
          const result = await Billing.updateMany(
            { 'plusStripeSubscriptionId': subId }, 
            { 
              $set: { 
                'plusActive': false,
                'plusCanceledAt': new Date()
              } 
            }
          );
          console.log('❌ Deactivated subscription result:', result);
        }
        break;
      }
      default:
        console.log('ℹ️ Unhandled webhook event type:', event.type);
        break;
    }
    return res.json({ received: true });
  } catch (err: any) {
    console.error('❌ Webhook handling error:', err);
    return res.status(500).json({ error: 'Webhook handler failure' });
  }
}

export async function confirmCheckoutSession(req: Request, res: Response) {
  try {
    console.log('🔔 Confirm checkout session called:', req.body);
    
    const stripe = requireStripe(res);
    if (!stripe) return;
    const { session_id } = (req.body || {}) as { session_id?: string };
    if (!session_id) return res.status(400).json({ success: false, error: { message: 'Missing session_id' }});

    console.log('🔍 Retrieving Stripe session:', session_id);
    const session = await stripe.checkout.sessions.retrieve(session_id, { expand: ['subscription'] });
    if (!session) return res.status(404).json({ success: false, error: { message: 'Session not found' }});

    console.log('✅ Session retrieved:', {
      id: session.id,
      status: session.status,
      paymentStatus: session.payment_status,
      product: (session.metadata as any)?.product,
      oxyUserId: (session.client_reference_id as string) || (session.metadata as any)?.oxyUserId
    });

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      console.log('❌ Session not completed:', { paymentStatus: session.payment_status, status: session.status });
      return res.status(409).json({ success: false, error: { message: 'Session not completed' }});
    }

    const product = (session.metadata as any)?.product as 'plus' | 'file' | 'founder' | undefined;
    const oxyUserId = (session.client_reference_id as string) || (session.metadata as any)?.oxyUserId;
    if (!product || !oxyUserId) return res.status(400).json({ success: false, error: { message: 'Missing product/oxyUserId in session' }});

    console.log('💰 Processing confirmed session:', { product, oxyUserId });

    const sessionId = String(session.id);
    
    // Ensure billing record exists
    let billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      console.log('📝 Creating billing record for user:', oxyUserId);
      billing = new Billing({
        oxyUserId,
        plusActive: false,
        fileCredits: 0,
        processedSessions: []
      });
      await billing.save();
    }
    
    if (product === 'file') {
      console.log('📄 Processing file credit purchase');
      const result = await Billing.updateOne(
        { oxyUserId, 'processedSessions': { $ne: sessionId } },
        { 
          $set: { 'lastPaymentAt': new Date() }, 
          $inc: { 'fileCredits': 1 }, 
          $addToSet: { 'processedSessions': sessionId }
        }
      );
      console.log('📄 File credit update result:', result);
    } else if (product === 'plus') {
      console.log('⭐ Processing Plus subscription');
      
      const setUpdate: any = { 
        'lastPaymentAt': new Date(), 
        'plusActive': true,
        'plusSince': new Date()
      };
      
      if (session.subscription) {
        setUpdate['plusStripeSubscriptionId'] = String(session.subscription['id'] || session.subscription);
      }
      
      const result = await Billing.updateOne(
        { oxyUserId, 'processedSessions': { $ne: sessionId } },
        { 
          $set: setUpdate, 
          $addToSet: { 'processedSessions': sessionId }
        }
      );
      console.log('⭐ Plus subscription update result:', result);
      
      // Return current entitlements
      const updated = await Billing.findOne({ oxyUserId }).lean();
      console.log('✅ Final entitlements:', updated);
      
      if (result.modifiedCount === 0) {
        console.warn('⚠️ No documents were modified. Session may have been processed already.');
        // Still return entitlements even if already processed
        const billingRecord = await Billing.findOne({ oxyUserId }).lean();
        return res.json({ success: true, entitlements: billingRecord });
      }
      
      return res.json({ 
        success: true, 
        entitlements: updated || {
          plusActive: false,
          fileCredits: 0,
          lastPaymentAt: new Date(),
          processedSessions: []
        }
      });
    } else if (product === 'founder') {
      console.log('💝 Processing Founder supporter');
      
      const result = await Billing.updateOne(
        { oxyUserId, 'processedSessions': { $ne: sessionId } },
        { 
          $set: { 
            'lastPaymentAt': new Date(),
            'founderSupporter': true,
            'founderSince': new Date()
          }, 
          $addToSet: { 'processedSessions': sessionId }
        }
      );
      console.log('💝 Founder supporter update result:', result);
      
      const updated = await Billing.findOne({ oxyUserId }).lean();
      return res.json({ 
        success: true, 
        entitlements: updated || {
          founderSupporter: true,
          founderSince: new Date(),
          lastPaymentAt: new Date(),
          processedSessions: []
        }
      });
    }
    
    return res.json({ success: true, message: 'Session processed successfully' });
  } catch (error: any) {
    console.error('Confirm checkout session error:', error);
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
      webhookUrl: `${process.env.API_URL || 'http://localhost:3000'}/api/billing/webhook`,
      successUrl: process.env.STRIPE_SUCCESS_URL || `${process.env.API_URL || 'http://localhost:3000'}/payments/success`,
      cancelUrl: process.env.STRIPE_CANCEL_URL || `${process.env.API_URL || 'http://localhost:3000'}/profile/subscriptions`
    };
    
    return res.json({ success: true, config });
  } catch (err: any) {
    console.error('Test webhook config error:', err);
    return res.status(500).json({ success: false, error: { message: err.message }});
  }
}

export async function debugBillingStatus(req: Request, res: Response) {
  try {
    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    // Find billing record for this user
    const billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      return res.status(404).json({ success: false, error: { message: 'Billing record not found', code: 'BILLING_NOT_FOUND' }});
    }

    // Get detailed billing information
    const billingInfo = {
      oxyUserId: billing.oxyUserId,
      billing: billing.toObject(),
      hasBilling: true,
      plusActive: !!billing.plusActive,
      plusSince: billing.plusSince,
      plusStripeSubscriptionId: billing.plusStripeSubscriptionId,
      fileCredits: billing.fileCredits || 0,
      lastPaymentAt: billing.lastPaymentAt,
      processedSessions: billing.processedSessions || [],
      processedSessionsCount: (billing.processedSessions || []).length
    };

    console.log('🔍 Billing debug info for user:', oxyUserId, billingInfo);

    return res.json({ 
      success: true, 
      billing: billingInfo,
      message: billingInfo.plusActive ? 'Plus subscription is active' : 'Plus subscription is not active'
    });
  } catch (err: any) {
    console.error('❌ Debug billing status error:', err);
    return res.status(500).json({ success: false, error: { message: err.message || 'Failed to get billing status' }});
  }
}

export async function debugSubscriptionStatus(req: Request, res: Response) {
  try {
    const stripe = requireStripe(res);
    if (!stripe) return;

    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    console.log('🔍 Debugging subscription status for user:', oxyUserId);

    // Find the billing record
    const billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      return res.status(404).json({ success: false, error: { message: 'No billing record found' }});
    }

    const debugInfo = {
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
      } catch (stripeError: any) {
        debugInfo.stripe = { error: stripeError.message };
        debugInfo.comparison = { error: 'Cannot compare - Stripe error' };
      }
    }

    return res.json({ success: true, debugInfo });
  } catch (error: any) {
    console.error('Debug subscription error:', error);
    return res.status(500).json({ 
      success: false, 
      error: { 
        message: error.message || 'Internal server error', 
        code: 'INTERNAL_ERROR'
      }
    });
  }
}

export async function manuallyActivateSubscription(req: Request, res: Response) {
  try {
    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    const { session_id, product = 'plus' } = req.body;
    if (!session_id) {
      return res.status(400).json({ success: false, error: { message: 'Missing session_id' }});
    }

    console.log('🔧 Manual subscription activation:', { oxyUserId, session_id, product });

    // Find or create billing record for this user
    let billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      console.log('📝 Creating new billing record for user:', oxyUserId);
      billing = new Billing({
        oxyUserId,
        plusActive: false,
        fileCredits: 0,
        processedSessions: []
      });
    }

    const sessionId = String(session_id);
    
    // Check if already processed
    if (billing.processedSessions?.includes(sessionId)) {
      console.log('⚠️ Session already processed:', sessionId);
      return res.json({ 
        success: true, 
        entitlements: billing.toObject(),
        message: 'Subscription already activated'
      });
    }

    if (product === 'plus') {
      // Activate Plus subscription
      billing.plusActive = true;
      billing.plusSince = new Date();
      billing.lastPaymentAt = new Date();
      billing.processedSessions = billing.processedSessions || [];
      billing.processedSessions.push(sessionId);
      
      await billing.save();
      
      console.log('✅ Plus subscription manually activated for user:', oxyUserId);
      
      return res.json({ 
        success: true, 
        entitlements: billing.toObject(),
        message: 'Plus subscription activated successfully'
      });
    } else if (product === 'file') {
      // Add file credit
      billing.fileCredits = (billing.fileCredits || 0) + 1;
      billing.lastPaymentAt = new Date();
      billing.processedSessions = billing.processedSessions || [];
      billing.processedSessions.push(sessionId);
      
      await billing.save();
      
      console.log('✅ File credit manually added for user:', oxyUserId);
      
      return res.json({ 
        success: true, 
        entitlements: billing.toObject(),
        message: 'File credit added successfully'
      });
    }

    return res.status(400).json({ success: false, error: { message: 'Invalid product type' }});
  } catch (err: any) {
    console.error('❌ Manual activation error:', err);
    return res.status(500).json({ success: false, error: { message: err.message || 'Failed to activate subscription' }});
  }
}

export async function createCustomerPortalSession(req: Request, res: Response) {
    try {
        const stripe = requireStripe(res);
        if (!stripe) return;

        const { subscriptionId } = req.body;
        const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;

        if (!oxyUserId) {
            return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
        }

        if (!subscriptionId) {
            return res.status(400).json({ success: false, error: { message: 'Subscription ID required', code: 'SUBSCRIPTION_ID_REQUIRED' }});
        }

        // Find the billing record to get the subscription details
        const billing = await Billing.findOne({ oxyUserId });
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
                return_url: `${process.env.FRONTEND_URL || 'http://localhost:8081'}/profile/subscriptions`,
            });

            return res.json({ success: true, url: session.url });
        } catch (stripeError: any) {
            console.error('Stripe customer portal error:', stripeError);
            
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
    } catch (error: any) {
        console.error('Customer portal session error:', error);
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
    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    console.log('🔧 Manually canceling subscription for user:', oxyUserId);

    const result = await Billing.updateOne(
      { oxyUserId },
      { 
        $set: { 
          'plusActive': false,
          'plusCanceledAt': new Date()
        } 
      }
    );

    console.log('🔧 Manual cancellation result:', result);

    if (result.modifiedCount === 0) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to cancel' }});
    }

    // Return updated entitlements
    const updated = await Billing.findOne({ oxyUserId }).lean();
    return res.json({ success: true, entitlements: updated });
  } catch (error: any) {
    console.error('Manual cancellation error:', error);
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

    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    console.log('🔄 Syncing subscription status for user:', oxyUserId);

    // Find the billing record
    const billing = await Billing.findOne({ oxyUserId });
    if (!billing) {
      return res.status(404).json({ success: false, error: { message: 'No billing record found' }});
    }

    console.log('🔄 Current billing record:', {
      oxyUserId: billing.oxyUserId,
      plusActive: billing.plusActive,
      plusStripeSubscriptionId: billing.plusStripeSubscriptionId,
      plusCanceledAt: billing.plusCanceledAt
    });

    if (!billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription ID found' }});
    }

    // Get current status from Stripe
    let subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(billing.plusStripeSubscriptionId);
      console.log('🔄 Stripe subscription status:', {
        id: subscription.id,
        status: subscription.status,
        cancel_at_period_end: subscription.cancel_at_period_end,
        canceled_at: subscription.canceled_at,
        current_period_end: subscription.current_period_end
      });
    } catch (stripeError: any) {
      console.error('🔄 Stripe error:', stripeError);
      return res.status(404).json({ 
        success: false, 
        error: { 
          message: `Subscription not found in Stripe: ${stripeError.message}`,
          code: 'SUBSCRIPTION_NOT_FOUND'
        }
      });
    }

    const updateData: any = {};
    let statusChanged = false;
    
    // Update based on Stripe status
    if (subscription.cancel_at_period_end && subscription.canceled_at) {
      if (!billing.plusCanceledAt || billing.plusActive) {
        updateData.plusCanceledAt = new Date(subscription.canceled_at * 1000);
        updateData.plusActive = false;
        statusChanged = true;
        console.log('❌ Marking as canceled at period end');
      }
    } else if (subscription.status === 'active' && !subscription.cancel_at_period_end) {
      if (!billing.plusActive || billing.plusCanceledAt) {
        updateData.plusActive = true;
        updateData.plusCanceledAt = undefined;
        statusChanged = true;
        console.log('✅ Marking as active');
      }
    } else if (subscription.status === 'canceled' || subscription.status === 'unpaid') {
      if (billing.plusActive || !billing.plusCanceledAt) {
        updateData.plusActive = false;
        updateData.plusCanceledAt = new Date();
        statusChanged = true;
        console.log('❌ Marking as canceled');
      }
    }

    if (Object.keys(updateData).length > 0) {
      const result = await Billing.updateOne(
        { oxyUserId },
        { $set: updateData }
      );
      console.log('🔄 Database update result:', result);
    } else {
      console.log('🔄 No changes needed - status already up to date');
    }

    // Return updated entitlements
    const updated = await Billing.findOne({ oxyUserId }).lean();
    return res.json({ 
      success: true, 
      entitlements: updated,
      syncInfo: {
        stripeStatus: subscription.status,
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        canceledAt: subscription.canceled_at,
        statusChanged,
        updateData
      }
    });
  } catch (error: any) {
    console.error('Sync subscription error:', error);
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
    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    console.log('🔧 Canceling subscription for user:', oxyUserId, 'immediate:', immediate);

    // Find the billing record to get the subscription ID
    const billing = await Billing.findOne({ oxyUserId });
    if (!billing || !billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to cancel' }});
    }

    // Cancel the subscription in Stripe
    console.log('🔧 Canceling subscription in Stripe:', billing.plusStripeSubscriptionId);
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

    console.log('🔧 Stripe cancellation result:', {
      id: canceledSubscription.id,
      status: canceledSubscription.status,
      cancel_at_period_end: canceledSubscription.cancel_at_period_end,
      canceled_at: canceledSubscription.canceled_at
    });

    // Update the database to reflect the cancellation
    const updateData: any = {};
    
    if (immediate) {
      updateData.plusActive = false;
      updateData.plusCanceledAt = new Date(canceledSubscription.canceled_at * 1000);
    } else {
      // For cancel at period end, we keep plusActive true but set canceledAt
      updateData.plusCanceledAt = new Date(canceledSubscription.canceled_at * 1000);
    }

    const result = await Billing.updateOne(
      { oxyUserId },
      { $set: updateData }
    );

    console.log('🔧 Database update result:', result);

    // Return updated entitlements
    const updated = await Billing.findOne({ oxyUserId }).lean();
    return res.json({ success: true, entitlements: updated });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
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

    const oxyUserId = (req as any)?.user?.id || (req as any)?.user?._id;
    
    if (!oxyUserId) {
      return res.status(401).json({ success: false, error: { message: 'Authentication required', code: 'AUTH_REQUIRED' }});
    }

    console.log('🔄 Reactivating subscription for user:', oxyUserId);

    // Find the billing record to get the subscription ID
    const billing = await Billing.findOne({ oxyUserId });
    if (!billing || !billing.plusStripeSubscriptionId) {
      return res.status(404).json({ success: false, error: { message: 'No subscription found to reactivate' }});
    }

    // Reactivate the subscription in Stripe
    console.log('🔄 Reactivating subscription in Stripe:', billing.plusStripeSubscriptionId);
    const reactivatedSubscription = await stripe.subscriptions.update(billing.plusStripeSubscriptionId, {
      cancel_at_period_end: false
    });

    console.log('🔄 Stripe reactivation result:', {
      id: reactivatedSubscription.id,
      status: reactivatedSubscription.status,
      cancel_at_period_end: reactivatedSubscription.cancel_at_period_end,
      canceled_at: reactivatedSubscription.canceled_at
    });

    // Update the database to reflect the reactivation
    const result = await Billing.updateOne(
      { oxyUserId },
      { 
        $set: { 
          'plusActive': true,
          'plusCanceledAt': undefined
        } 
      }
    );

    console.log('🔄 Database update result:', result);

    // Return updated entitlements
    const updated = await Billing.findOne({ oxyUserId }).lean();
    return res.json({ success: true, entitlements: updated });
  } catch (error: any) {
    console.error('Reactivate subscription error:', error);
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
    console.log('🔧 Testing webhook endpoint');
    console.log('🔧 Headers:', req.headers);
    console.log('🔧 Body:', req.body);
    console.log('🔧 Method:', req.method);
    console.log('🔧 URL:', req.url);
    
    return res.json({ 
      success: true, 
      message: 'Webhook endpoint is working',
      timestamp: new Date().toISOString(),
      headers: req.headers,
      body: req.body
    });
  } catch (error: any) {
    console.error('Webhook test error:', error);
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
