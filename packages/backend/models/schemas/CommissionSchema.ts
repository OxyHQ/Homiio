/**
 * Commission Schema
 * Mongoose schema for a Partner's earned commission on a closed deal.
 *
 * Created when a property sourced by a Partner transitions to a closed/
 * transacted state (rented / sold / exchanged). Exactly one Commission exists
 * per property — enforced by the unique index on `propertyId` so the close
 * trigger is idempotent. The partner payout (`amount`) is a small, mostly-flat
 * reward (3% of first month's rent, or a flat sale/exchange reward); how it was
 * derived is captured in `basis` for audit.
 *
 * Status flow: `pending` → `approved` (deal closed) → `paid` (Phase 2) /
 * `cancelled`. Commissions are created `approved` since they only exist once a
 * deal has closed.
 */

const mongoose = require('mongoose');

const COMMISSION_STATUSES: ReadonlyArray<string> = ['pending', 'approved', 'paid', 'cancelled'];
const COMMISSION_OFFERINGS: ReadonlyArray<string> = ['rent', 'sale', 'exchange'];
const COMMISSION_KINDS: ReadonlyArray<string> = ['percentOfMonthlyRent', 'flat'];

const commissionBasisSchema = new mongoose.Schema({
  offering: {
    type: String,
    enum: COMMISSION_OFFERINGS,
    required: [true, 'Commission offering is required']
  },
  // Monthly rent (rent) or sale price (sale) the payout was derived from; 0 for exchange.
  dealValue: {
    type: Number,
    required: [true, 'Deal value is required'],
    min: [0, 'Deal value cannot be negative']
  },
  // Whether the payout is a percentage of monthly rent or a flat reward.
  kind: {
    type: String,
    enum: COMMISSION_KINDS,
    required: [true, 'Commission kind is required']
  },
  // Fraction of monthly rent paid out, when kind is `percentOfMonthlyRent`.
  rate: {
    type: Number,
    min: [0, 'Rate cannot be negative'],
    max: [1, 'Rate cannot exceed 1']
  },
  // Flat payout amount, in major units, when kind is `flat`.
  flat: {
    type: Number,
    min: [0, 'Flat reward cannot be negative']
  }
}, { _id: false });

const commissionSchema = new mongoose.Schema({
  partnerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Partner',
    required: [true, 'Partner ID is required'],
    index: true
  },
  propertyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Property',
    required: [true, 'Property ID is required'],
    index: true
  },
  // Partner payout, in major currency units.
  amount: {
    type: Number,
    required: [true, 'Commission amount is required'],
    min: [0, 'Commission amount cannot be negative']
  },
  currency: {
    type: String,
    required: [true, 'Currency is required'],
    uppercase: true,
    minlength: 3,
    maxlength: 3,
    default: 'EUR'
  },
  basis: {
    type: commissionBasisSchema,
    required: [true, 'Commission basis is required']
  },
  status: {
    type: String,
    enum: COMMISSION_STATUSES,
    default: 'pending',
    required: true,
    index: true
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true,
    transform: function(_doc: any, ret: any) {
      ret.id = ret._id;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// One commission per property — enforces the close trigger's idempotency at the
// DB layer (the service also guards with an existence check).
commissionSchema.index({ propertyId: 1 }, { unique: true });
// Partner earnings-ledger lookups (newest first).
commissionSchema.index({ partnerId: 1, createdAt: -1 });

module.exports = mongoose.model('Commission', commissionSchema);
