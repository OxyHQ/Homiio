/**
 * Requirements, uploads and verification as three facts (#518 §7.4).
 *
 * §7.4: "El checklist debe reflejar estados verdaderos de requisitos, upload y
 * verificación. Pulsar un botón no convierte localmente un documento en
 * verificado."
 *
 * The rule lives in two places and only one of them is code: the server is the
 * only thing that can write a verification, and this function is the only thing
 * that decides what a line SAYS. So the cases below are about the sentences a
 * person reads — and the one that matters most is that an upload nobody has
 * opened never reads as done.
 */

import {
  TenantApplicationDocumentType,
  applicationChecklist,
  everyRequirementVerified,
  type ChecklistDocument,
} from '@homiio/shared-types';

const ID = TenantApplicationDocumentType.ID;
const INCOME = TenantApplicationDocumentType.INCOME;
const REFERENCE = TenantApplicationDocumentType.REFERENCE;

function doc(
  type: TenantApplicationDocumentType,
  verification: ChecklistDocument['verification'],
  id = `${type}-${verification}`,
): ChecklistDocument {
  return { id, type, filename: `${type}.pdf`, verification };
}

describe('what a line says', () => {
  it('calls a requirement with nothing against it missing', () => {
    const [line] = applicationChecklist([ID], []);
    expect(line).toMatchObject({ type: ID, required: true, status: 'missing' });
  });

  it('does NOT call an unread upload done', () => {
    // The whole rule. A tick here would be the local verification §7.4 forbids,
    // arriving through arithmetic instead of through a button.
    const [line] = applicationChecklist([ID], [doc(ID, 'pending')]);
    expect(line.status).toBe('awaiting_review');
    expect(line.status).not.toBe('verified');
  });

  it('calls it verified only once somebody verified it', () => {
    const [line] = applicationChecklist([ID], [doc(ID, 'verified')]);
    expect(line.status).toBe('verified');
  });

  it('carries the rejection reason, because a refusal with none is a dead end', () => {
    const rejected: ChecklistDocument = {
      ...doc(ID, 'rejected'),
      rejectionReason: 'The photo is cut off',
    };
    const [line] = applicationChecklist([ID], [rejected]);
    expect(line.status).toBe('rejected');
    expect(line.documents[0].rejectionReason).toBe('The photo is cut off');
  });
});

describe('a line with several documents', () => {
  it('takes the BEST outcome, not the worst', () => {
    // Somebody whose payslip was rejected and who then sent a contract that was
    // verified has satisfied the requirement. Showing the line as rejected
    // would tell them to do something they have already done.
    const [line] = applicationChecklist([INCOME], [doc(INCOME, 'rejected'), doc(INCOME, 'verified')]);
    expect(line.status).toBe('verified');
    // …and the rejected one is still listed, so nothing is hidden.
    expect(line.documents).toHaveLength(2);
  });

  it('is awaiting review while anything is still unread', () => {
    const [line] = applicationChecklist([INCOME], [doc(INCOME, 'rejected'), doc(INCOME, 'pending')]);
    expect(line.status).toBe('awaiting_review');
  });
});

describe('what is shown at all', () => {
  it('shows a volunteered document nobody asked for', () => {
    const items = applicationChecklist([ID], [doc(ID, 'verified'), doc(REFERENCE, 'pending')]);
    const volunteered = items.find((item) => item.type === REFERENCE);
    // Hiding it would lose a document the applicant took the trouble to send.
    expect(volunteered).toMatchObject({ required: false, status: 'awaiting_review' });
  });

  it('keeps the landlord\'s ordering, then whatever else arrived', () => {
    const items = applicationChecklist([INCOME, ID], [doc(REFERENCE, 'pending'), doc(ID, 'pending')]);
    expect(items.map((item) => item.type)).toEqual([INCOME, ID, REFERENCE]);
  });

  it('shows nothing at all when nothing was asked for or sent', () => {
    expect(applicationChecklist([], [])).toEqual([]);
  });
});

describe('whether a landlord can decide', () => {
  it('is false while a required document is merely uploaded', () => {
    const items = applicationChecklist([ID, INCOME], [doc(ID, 'verified'), doc(INCOME, 'pending')]);
    // "Ready to decide" must not be reachable by an applicant alone.
    expect(everyRequirementVerified(items)).toBe(false);
  });

  it('ignores a volunteered document that is still unread', () => {
    const items = applicationChecklist([ID], [doc(ID, 'verified'), doc(REFERENCE, 'pending')]);
    // It was not asked for, so it cannot hold the decision up.
    expect(everyRequirementVerified(items)).toBe(true);
  });

  it('is true when nothing was required — which is not the same as praise', () => {
    expect(everyRequirementVerified(applicationChecklist([], [doc(ID, 'pending')]))).toBe(true);
  });
});
