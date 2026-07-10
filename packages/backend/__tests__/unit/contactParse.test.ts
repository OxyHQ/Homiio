/**
 * Shared contact mapping chokepoint (`parse/contact.ts`).
 * Pure unit tests — no DB, no live portal hits.
 */

import {
  buildContact,
  contactFromAjaxBody,
  contactFromRecord,
  contactFromUnknown,
  extractContactFromHtml,
  hasContactFields,
  mergeContact,
  normalizeEmail,
  normalizePhone,
  normalizeWhatsapp,
  parseContactPhonesJson,
} from '@homiio/listing-providers';

describe('contact phone normalization', () => {
  it('keeps leading plus and strips formatting', () => {
    expect(normalizePhone('+34 612 345 678')).toBe('+34612345678');
  });

  it('returns digits-only when no plus prefix', () => {
    expect(normalizePhone('(493) 098-765432')).toBe('493098765432');
  });

  it('rejects too-short numbers', () => {
    expect(normalizePhone('12345')).toBeUndefined();
    expect(normalizePhone(undefined)).toBeUndefined();
  });
});

describe('contact email and whatsapp normalization', () => {
  it('accepts valid emails and rejects malformed ones', () => {
    expect(normalizeEmail(' agent@example.com ')).toBe('agent@example.com');
    expect(normalizeEmail('not-an-email')).toBeUndefined();
  });

  it('extracts whatsapp digits from wa.me links', () => {
    expect(normalizeWhatsapp('https://wa.me/34612345678')).toBe('34612345678');
    expect(normalizeWhatsapp('+34 612 345 678')).toBe('+34612345678');
  });
});

describe('parseContactPhonesJson', () => {
  it('collects phones from nested JSON shapes', () => {
    const body = JSON.stringify({
      data: {
        phoneNumbers: [{ formattedPhone: '+34 612 345 678' }, { phone: '34987654321' }],
      },
    });
    expect(parseContactPhonesJson(body)).toEqual(['+34612345678', '34987654321']);
  });

  it('returns empty array for DataDome challenge bodies', () => {
    const challenge = '<!DOCTYPE html><html>geo.captcha-delivery.com</html>';
    expect(parseContactPhonesJson(challenge)).toEqual([]);
    expect(parseContactPhonesJson(challenge, () => true)).toEqual([]);
  });

  it('parses a bare phone string fallback', () => {
    expect(parseContactPhonesJson('  +34 612 345 678 ')).toEqual(['+34612345678']);
  });
});

describe('contactFromRecord', () => {
  it('maps Idealista-style contactData.agent fields', () => {
    const contact = contactFromRecord({
      contactData: {
        agent: {
          name: 'María López',
          company: 'Agencia Demo SL',
          phone: '+34 612 345 678',
          email: 'maria@agencia.demo',
          whatsapp: '34612345678',
        },
      },
      isPrivateOwner: false,
    });
    expect(contact.phone).toBe('+34612345678');
    expect(contact.email).toBe('maria@agencia.demo');
    expect(contact.whatsapp).toBe('34612345678');
    expect(contact.name).toBe('María López');
    expect(contact.agencyName).toBe('Agencia Demo SL');
    expect(contact.kind).toBe('agency');
  });

  it('marks private owners when isPrivateOwner is true', () => {
    const contact = contactFromRecord({
      isPrivateOwner: true,
      contactName: 'Juan Pérez',
      phone: '+34 600 111 222',
    });
    expect(contact.kind).toBe('private');
    expect(contact.name).toBe('Juan Pérez');
  });
});

describe('buildContact and merge helpers', () => {
  it('buildContact omits empty contact objects', () => {
    expect(buildContact({})).toBeUndefined();
    expect(
      buildContact({ phone: '+34612345678', agencyName: 'Demo Agency' }),
    ).toEqual({
      phone: '+34612345678',
      agencyName: 'Demo Agency',
    });
  });

  it('mergeContact overlays later parts', () => {
    const merged = mergeContact(
      { phone: '+34111111111', name: 'Old' },
      { email: 'new@example.com', name: 'New Agent' },
    );
    expect(merged).toEqual({
      phone: '+34111111111',
      email: 'new@example.com',
      name: 'New Agent',
    });
  });
});

describe('contactFromAjaxBody and HTML extraction', () => {
  it('returns undefined for challenge ajax bodies', () => {
    expect(contactFromAjaxBody('<html>datadome captcha-delivery</html>')).toBeUndefined();
  });

  it('parses ajax contact info JSON', () => {
    const body = JSON.stringify({
      contactNameToDisplay: 'Ana Ruiz',
      agencyNameToDisplay: 'Inmobiliaria Norte',
      emailToDisplay: 'ana@norte.demo',
      phoneNumbers: ['+34 612 000 111'],
    });
    expect(contactFromAjaxBody(body)).toEqual({
      phone: '+34612000111',
      email: 'ana@norte.demo',
      name: 'Ana Ruiz',
      agencyName: 'Inmobiliaria Norte',
    });
  });

  it('extracts tel/mailto/whatsapp links from listing HTML', () => {
    const html = `
      <a href="tel:%2B34612345678">Call</a>
      <a href="mailto:agent@portal.example">Email</a>
      <a href="https://wa.me/34612345678">WhatsApp</a>
      <span>privat</span>
    `;
    const contact = extractContactFromHtml(html);
    expect(contact?.phone).toBe('+34612345678');
    expect(contact?.email).toBe('agent@portal.example');
    expect(contact?.whatsapp).toBe('34612345678');
    expect(contact?.kind).toBe('private');
    expect(hasContactFields(contact)).toBe(true);
    expect(hasContactFields(undefined)).toBe(false);
  });

  it('contactFromUnknown delegates to contactFromRecord', () => {
    expect(contactFromUnknown({ email: 'x@y.z', phone: '+34123456789' })?.email).toBe('x@y.z');
  });
});
