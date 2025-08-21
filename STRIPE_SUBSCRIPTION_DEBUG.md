# Stripe Subscription Debugging Guide

## Issue Description
Subscriptions are not being saved to the database after successful Stripe payment. The payment redirects back correctly, but the `plusActive` field remains `false` in the profile.

## 🔍 **Quick Check: Is it being saved to DB?**

### Option 1: Frontend Debug Page
Navigate to: `/profile/debug-billing` in your app to see real-time billing status.

### Option 2: API Endpoint
```bash
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://localhost:3000/api/billing/debug-billing
```

### Option 3: Database Script
```bash
cd packages/backend
npm run check:subscriptions

# Check specific user
npm run check:subscriptions user YOUR_USER_ID

# Check recent updates
npm run check:subscriptions recent
```

## Debugging Steps

### 1. Check Environment Variables
First, verify all required Stripe environment variables are set:

```bash
# Required variables
STRIPE_SECRET_KEY=sk_test_... or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_PLUS=price_... (for Plus subscription)
STRIPE_PRICE_FILE=price_... (for file credits)

# Optional variables
STRIPE_SUCCESS_URL=https://yourdomain.com/payments/success
STRIPE_CANCEL_URL=https://yourdomain.com/profile/subscriptions
API_URL=https://yourdomain.com
```

### 2. Test Webhook Configuration
Visit the test endpoint to verify Stripe configuration:

```
GET /api/billing/webhook-test
```

This will show:
- Whether Stripe is properly configured
- Which environment variables are missing
- The webhook URL that should be configured in Stripe dashboard

### 3. Check Stripe Dashboard Webhook Configuration

In your Stripe Dashboard:
1. Go to **Developers > Webhooks**
2. Verify there's a webhook endpoint pointing to: `https://yourdomain.com/api/billing/webhook`
3. Ensure the webhook is listening for these events:
   - `checkout.session.completed`
   - `invoice.payment_failed`
   - `customer.subscription.deleted`
4. Copy the webhook signing secret and set it as `STRIPE_WEBHOOK_SECRET`

### 4. Monitor Server Logs
The enhanced logging will now show detailed information about webhook processing. Look for:

```
🔔 Stripe webhook received: { hasSignature: true, hasWebhookSecret: true, ... }
✅ Webhook signature verified, event type: checkout.session.completed
💰 Checkout session completed: { sessionId: ..., product: 'plus', profileId: ... }
⭐ Processing Plus subscription for profile: ...
⭐ Plus subscription update result: { modifiedCount: 1, ... }
✅ Profile billing after update: { plusActive: true, ... }
```

### 5. Test the Complete Flow

1. **Start a test subscription:**
   ```bash
   curl -X POST http://localhost:3000/api/billing/checkout \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"product": "plus"}'
   ```

2. **Complete payment on Stripe** (use test card: 4242 4242 4242 4242)

3. **Check server logs** for webhook processing

4. **Verify database update:**
   ```bash
   # Check your specific user
   npm run check:subscriptions user YOUR_USER_ID
   ```

### 6. Common Issues and Solutions

#### Issue: Webhook not receiving events
**Symptoms:** No webhook logs in server console
**Solutions:**
- Verify webhook URL is correct and accessible
- Check webhook secret matches environment variable
- Ensure webhook is enabled in Stripe dashboard
- Test webhook endpoint manually

#### Issue: Webhook signature verification fails
**Symptoms:** "Webhook signature verification failed" error
**Solutions:**
- Verify `STRIPE_WEBHOOK_SECRET` is correct
- Ensure webhook endpoint receives raw body (not parsed JSON)
- Check that webhook URL in Stripe dashboard matches exactly

#### Issue: Profile not found
**Symptoms:** "No profileId found in session" error
**Solutions:**
- Verify user has an active profile
- Check that `client_reference_id` is being set correctly in checkout session
- Ensure profile ID is valid MongoDB ObjectId

#### Issue: Database update fails
**Symptoms:** Webhook processes but profile not updated
**Solutions:**
- Check MongoDB connection
- Verify profile document exists
- Check for database permissions
- Look for MongoDB errors in logs

### 7. Manual Testing Endpoints

#### Test webhook configuration:
```
GET /api/billing/webhook-test
```

#### Test checkout session creation:
```
POST /api/billing/checkout
Content-Type: application/json
Authorization: Bearer YOUR_TOKEN

{
  "product": "plus"
}
```

#### Test session confirmation:
```
POST /api/billing/confirm
Content-Type: application/json

{
  "session_id": "cs_test_..."
}
```

#### Check billing status:
```
GET /api/billing/debug-billing
Authorization: Bearer YOUR_TOKEN
```

### 8. Database Schema Verification

Ensure your profile schema includes the billing fields:

```javascript
billing: {
  plusActive: { type: Boolean, default: false },
  plusSince: { type: Date },
  plusStripeSubscriptionId: { type: String },
  fileCredits: { type: Number, default: 0 },
  lastPaymentAt: { type: Date },
  processedSessions: { type: [String], default: [] }
}
```

### 9. Testing Commands

```bash
# Test webhook configuration
npm run test:webhook

# Check all subscriptions in database
npm run check:subscriptions

# Check specific user
npm run check:subscriptions user YOUR_USER_ID

# Check recent updates
npm run check:subscriptions recent
```

### 10. Next Steps

1. **Run the database check** to see current status
2. **Check server logs** during a test subscription
3. **Verify webhook is configured** in Stripe dashboard
4. **Test with a small payment** to see the complete flow
5. **Monitor database** for profile updates

If the issue persists after following these steps, please share:
- Server logs during webhook processing
- Output from `/api/billing/webhook-test` endpoint
- Output from `/api/billing/debug-billing` endpoint
- Database check results
- Stripe webhook configuration screenshot
