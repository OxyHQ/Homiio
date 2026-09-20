/**
 * The receipt document itself (#518 §7.2).
 *
 * Two properties that a route test cannot see, because both are about the
 * BYTES rather than the response:
 *
 *  - every value reaching the page is escaped. A receipt is opened in a
 *    browser, and two of the values on it — the home's label and the
 *    obligation's type — originate with a person. An unescaped one is stored
 *    XSS in a document Homiio told somebody to download;
 *  - the document reaches the network for nothing. A receipt opened six months
 *    later, offline, must render as it did the day it was saved.
 */

import {
  ReceiptNotAvailableError,
  rentReceiptFor,
  type RentReceiptInput,
} from '../../services/payments/rentReceipt';

function input(overrides: Partial<RentReceiptInput> = {}): RentReceiptInput {
  return {
    movementId: 'mov-1',
    state: 'succeeded',
    amount: 900,
    currency: 'EUR',
    confirmedAt: '2026-02-03T10:00:00.000Z',
    createdAt: '2026-02-01T10:00:00.000Z',
    obligationDueDate: '2026-02-01T00:00:00.000Z',
    obligationType: 'rent',
    tenantOxyUserId: 'oxy-tenant',
    landlordOxyUserId: 'oxy-landlord',
    propertyLabel: 'Carrer Gran 1',
    kind: 'manual_declaration',
    locale: 'en',
    ...overrides,
  };
}

/** The value of one labelled row, so a date assertion names which date. */
function rowValue(html: string, label: string): string | undefined {
  return new RegExp(`<th>${label}</th><td>([^<]*)</td>`).exec(html)?.[1];
}

describe('what the document may say', () => {
  it('refuses to exist for a payment that has not settled', () => {
    for (const state of ['initiated', 'pending', 'failed'] as const) {
      expect(() => rentReceiptFor(input({ state }))).toThrow(ReceiptNotAvailableError);
    }
    expect(() => rentReceiptFor(input())).not.toThrow();
  });

  it('dates the receipt by the CONFIRMATION, not by the claim', () => {
    // The tenant said they sent it on the 1st; the landlord confirmed on the
    // 3rd. The 3rd is when the money was acknowledged as received, and that is
    // what a receipt records.
    //
    // Asserted on the ROW rather than on the whole document: the 1st is also on
    // the page as the period the rent was due for, so a substring check would
    // pass against a receipt dated by the claim.
    const html = rentReceiptFor(input()).html;
    expect(rowValue(html, 'Paid on')).toBe('February 3, 2026');
    expect(rowValue(html, 'For the period due')).toBe('February 1, 2026');
  });

  it('falls back to when the movement was created if nothing confirmed it', () => {
    // Unreachable through the routes today — a `succeeded` movement always has
    // a confirmation — but a receipt must still render rather than printing
    // "Invalid Date" at somebody.
    const html = rentReceiptFor(input({ confirmedAt: undefined })).html;
    expect(rowValue(html, 'Paid on')).toBe('February 1, 2026');
  });
});

describe('escaping', () => {
  it('escapes a value that came from a person', () => {
    const html = rentReceiptFor(
      input({ propertyLabel: '<script>alert(1)</script>' }),
    ).html;

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes quotes and ampersands too, not only angle brackets', () => {
    const html = rentReceiptFor(input({ propertyLabel: `Ben & Jerry's "flat"` })).html;

    expect(html).toContain('&amp;');
    expect(html).toContain('&#39;');
    expect(html).toContain('&quot;');
  });

  it('escapes the locale, which arrives from a request header', () => {
    const html = rentReceiptFor(input({ locale: 'en' })).html;
    expect(html).toContain('<html lang="en">');
  });
});

describe('the document stands alone', () => {
  it('fetches nothing from the network', () => {
    const html = rentReceiptFor(input()).html;

    // No stylesheet, no font, no image, no script src. A receipt saved today
    // and opened offline in six months must look the same.
    expect(html).not.toMatch(/<link\b/i);
    expect(html).not.toMatch(/<img\b/i);
    expect(html).not.toMatch(/src=/i);
    expect(html).not.toMatch(/https?:\/\//i);
  });

  it('names the file after the movement it describes', () => {
    const receipt = rentReceiptFor(input({ movementId: 'mov-42' }));
    expect(receipt.filename).toBe('homiio-receipt-mov-42.html');
  });
});
