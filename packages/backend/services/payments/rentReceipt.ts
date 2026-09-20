/**
 * A receipt for rent that actually settled (#518 §7.2, #519 §7.2).
 *
 * §7.2 asks for "recibos reales con permisos de descarga. Totales y estados
 * derivados de datos persistidos, no de una página parcial ni de las cifras del
 * template." Both halves matter, and the second is the one that shapes this
 * module.
 *
 * ## Derived, never stored
 *
 * A receipt is not a file somebody uploads and not a row anybody writes. It is
 * a RENDERING of the ledger at the moment it is asked for, built from the
 * movement, its obligation and the lease. That is why there is no receipt
 * table, no object in a bucket and no migration: storing one would create a
 * second answer to "what was paid", and the stored copy is the one that would
 * go on saying something the ledger no longer does — after a refund, most
 * obviously.
 *
 * It also means a receipt cannot exist for a payment that did not happen.
 * {@link rentReceiptFor} refuses anything but a `succeeded` movement, so the
 * document and the balance cannot disagree.
 *
 * ## HTML, and why not PDF
 *
 * A PDF would be the nicer artefact and it is a deliberate follow-up rather
 * than an oversight: nothing in the API image can render one. The repository
 * carries `pdf-parse` (reading) and no writer, and Playwright lives only in the
 * WORKER image — `AGENTS.md` is explicit that only `worker` carries
 * Playwright/Chromium. Adding a renderer is a dependency decision with a
 * lockfile gate attached, and it is not worth blocking a real receipt on.
 *
 * What ships is a self-contained HTML document with no external reference of
 * any kind — no stylesheet, no font, no image — served as a download. Every
 * desktop and phone prints it to PDF, and it carries the same numbers because
 * they come from the same place.
 */

import { formatMoney, type LeaseMovementState } from '@homiio/shared-types';

/** Everything a receipt says, resolved by the caller from persisted rows. */
export interface RentReceiptInput {
  readonly movementId: string;
  readonly state: LeaseMovementState;
  readonly amount: number;
  readonly currency: string;
  /** When the landlord confirmed it. The receipt's date, not the claim's. */
  readonly confirmedAt: string | undefined;
  readonly createdAt: string;
  /** What the payment was for — the obligation's due date and kind. */
  readonly obligationDueDate: string | undefined;
  readonly obligationType: string | undefined;
  /** Both parties, so the document says who paid whom. */
  readonly tenantOxyUserId: string;
  readonly landlordOxyUserId: string;
  readonly propertyLabel: string | undefined;
  /** `manual_declaration` or `processor` — a receipt says how it was paid. */
  readonly kind: string;
  /** The locale to format money and dates in. */
  readonly locale: string;
}

export interface RentReceipt {
  readonly filename: string;
  readonly contentType: 'text/html; charset=utf-8';
  readonly html: string;
}

export class ReceiptNotAvailableError extends Error {
  constructor(public readonly reason: 'not_settled') {
    super('A receipt exists only for a settled payment');
    this.name = 'ReceiptNotAvailableError';
  }
}

/**
 * Render the receipt, or refuse.
 *
 * Refuses anything but `succeeded`. A receipt for a `pending` declaration would
 * be a document asserting that money arrived because somebody said it had —
 * which is the exact confusion the whole ledger is built to prevent, printed
 * onto a page and handed to a tenant.
 */
export function rentReceiptFor(input: RentReceiptInput): RentReceipt {
  if (input.state !== 'succeeded') throw new ReceiptNotAvailableError('not_settled');

  const paidOn = input.confirmedAt ?? input.createdAt;
  const rows: Array<[string, string]> = [
    ['Reference', input.movementId],
    ['Paid on', formatDay(paidOn, input.locale)],
    ['Amount', formatMoney(input.amount, input.currency, input.locale)],
    ['Method', input.kind === 'processor' ? 'Card or transfer via processor' : 'Bank transfer, confirmed by the landlord'],
  ];
  if (input.obligationDueDate) rows.push(['For the period due', formatDay(input.obligationDueDate, input.locale)]);
  if (input.obligationType) rows.push(['Covers', input.obligationType.replace(/_/g, ' ')]);
  if (input.propertyLabel) rows.push(['Home', input.propertyLabel]);
  rows.push(['Paid by', input.tenantOxyUserId]);
  rows.push(['Received by', input.landlordOxyUserId]);

  return {
    filename: `homiio-receipt-${input.movementId}.html`,
    contentType: 'text/html; charset=utf-8',
    html: document(rows, paidOn, input.locale),
  };
}

/** A civil day, in the reader's locale, from an ISO instant. */
function formatDay(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(date);
}

/**
 * Escape everything that reaches the page.
 *
 * Every value here comes from a database row, and two of them — the property
 * label and the obligation type — originate with a person. A receipt is opened
 * in a browser, so an unescaped value is stored XSS in a document Homiio told
 * somebody to download. The whole document is built through this function; no
 * value reaches the template any other way.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function document(rows: Array<[string, string]>, paidOn: string, locale: string): string {
  const body = rows
    .map(([label, value]) => `    <tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join('\n');

  // Self-contained on purpose: no stylesheet, no font, no image, nothing that
  // reaches the network. A receipt opened six months later offline must render
  // exactly as it did the day it was downloaded.
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
<head>
<meta charset="utf-8">
<title>Homiio rent receipt</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 3rem auto; max-width: 34rem; color: #111; }
  h1 { font-size: 1.25rem; margin-bottom: 0.25rem; }
  p.meta { color: #555; margin-top: 0; font-size: 0.9rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 1.5rem; }
  th, td { text-align: left; padding: 0.5rem 0; border-bottom: 1px solid #e5e5e5; vertical-align: top; }
  th { width: 12rem; font-weight: 600; color: #555; }
  footer { margin-top: 2rem; font-size: 0.8rem; color: #777; }
</style>
</head>
<body>
<h1>Rent receipt</h1>
<p class="meta">Issued by Homiio on ${escapeHtml(formatDay(paidOn, locale))}</p>
<table>
${body}
</table>
<footer>This receipt is generated from Homiio's payment ledger. It records a payment the landlord confirmed as received.</footer>
</body>
</html>
`;
}
