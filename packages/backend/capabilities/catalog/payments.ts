/**
 * Rent payments — the lease LEDGER, not a processor.
 *
 * Homiio has no payment processor (Peable is not connected,
 * `docs/peable-rent-payments.md`), so no tool here moves money. What a person
 * can do is RECORD it: a tenant declares a payment they made, a landlord
 * confirms or rejects it, records a refund they sent, or adds an amount due.
 * Every one of those changes what the ledger says is owed or paid, so each is a
 * `financeTool`: the `finance` package, `effect: 'financial'`, an
 * Idempotency-Key required (it is also the ledger write's own key, so a retry
 * is the same movement), a limit key on every amount, and the internal lane
 * only — an OAuth grant cannot carry a numeric ceiling.
 */

import type { CatalogTool } from '@oxy.so/contracts';

import { LEASE_PAYMENT_STATUSES, LEASE_PAYMENT_TYPES } from '../../db/schema/leases';
import {
  enumInput,
  financeTool,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const amountInput = {
  type: 'number',
  exclusiveMinimum: 0,
  description: "In the lease's currency (major units, e.g. 850.5).",
} as const;
const amountLimit = [{ key: 'amount', kind: 'maximum_number' as const }];

export const PAYMENT_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyPayments',
    description:
      'List the amounts due (rent, deposits, fees, utilities) on every lease the person is a party to, soonest due first, each with its leaseId. Use getLeaseLedger for what has actually been paid.',
    capability: 'housing.payments.read',
    input: objectInput({
      page: pageInput,
      limit: limitInput,
      status: enumInput(LEASE_PAYMENT_STATUSES),
    }),
  }),
  readTool({
    name: 'listLeasePayments',
    description:
      "List one lease's payment schedule (what is owed and when), soonest due first. Parties only.",
    capability: 'housing.payments.read',
    input: objectInput(
      {
        leaseId: idInput,
        page: pageInput,
        limit: limitInput,
        status: enumInput(LEASE_PAYMENT_STATUSES),
      },
      ['leaseId'],
    ),
  }),
  readTool({
    name: 'getLeaseLedger',
    description:
      "Read a lease's rent ledger: every declared, confirmed, rejected and refunded movement, and what each obligation stands at (paid, outstanding). Parties only; another lease answers not-found.",
    capability: 'housing.payments.read',
    input: objectInput({ leaseId: idInput }, ['leaseId']),
  }),
  financeTool({
    name: 'createLeasePaymentObligation',
    description:
      'As the landlord, add an amount due to a lease (rent, deposit, fee or utility) on a date. Records an obligation; it charges nobody.',
    capability: 'housing.payments.manage',
    input: objectInput(
      {
        leaseId: idInput,
        dueDate: isoDateInput,
        amount: amountInput,
        type: enumInput(LEASE_PAYMENT_TYPES),
        description: optionalTextInput(500),
      },
      ['leaseId', 'dueDate', 'amount', 'type'],
    ),
    limitKeys: amountLimit,
  }),
  financeTool({
    name: 'declareRentPayment',
    description:
      'As a tenant or co-tenant, record that the person paid (part of) an amount due — e.g. a bank transfer they made. It stays pending until the landlord confirms it and does not change the balance before that. Refused above what is outstanding. Homiio does not move the money; there is no card or processor payment.',
    capability: 'housing.payments.declare',
    input: objectInput(
      {
        leaseId: idInput,
        obligationId: idInput,
        amount: amountInput,
        note: optionalTextInput(500),
      },
      ['leaseId', 'obligationId', 'amount'],
    ),
    limitKeys: amountLimit,
  }),
  financeTool({
    name: 'confirmRentPayment',
    description:
      "As the landlord, confirm that a tenant's declared payment arrived. The only action that moves a lease's balance.",
    capability: 'housing.payments.manage',
    input: objectInput({ leaseId: idInput, movementId: idInput }, ['leaseId', 'movementId']),
    limitKeys: [],
  }),
  financeTool({
    name: 'rejectRentPayment',
    description:
      "As the landlord, reject a tenant's declared payment that did not arrive, with a reason the tenant is shown.",
    capability: 'housing.payments.manage',
    input: objectInput({ leaseId: idInput, movementId: idInput, reason: textInput(500) }, [
      'leaseId',
      'movementId',
      'reason',
    ]),
    limitKeys: [],
  }),
  financeTool({
    name: 'refundRentPayment',
    description:
      'As the landlord, record a refund the person sent back for a confirmed payment (at most that payment). A new ledger movement; the original stays confirmed.',
    capability: 'housing.payments.manage',
    input: objectInput(
      { leaseId: idInput, movementId: idInput, amount: amountInput, note: optionalTextInput(500) },
      ['leaseId', 'movementId', 'amount'],
    ),
    limitKeys: amountLimit,
  }),
];
