/**
 * The profile edit form is only reachable signed in, so no web export check
 * sees it. This renders every section through the Bloom controls it is built
 * from (Select, DatePicker, PhoneInput, Checkbox, SettingsList) and pins the
 * string adapters that sit between those controls and the form's storage
 * shape: `+<dial> <number>` phones and `YYYY-MM-DD` dates.
 */
import React from 'react';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PersonalProfileSections } from '@/components/profile/edit/PersonalProfileSections';
import { joinPhone, splitPhone, parseDateInput, formatDateInput } from '@/components/profile/edit/fields';
import { NotificationItem } from '@/components/NotificationItem';

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

const noop = () => undefined;

const props = {
  personalInfo: {
    bio: 'hi',
    occupation: '',
    employer: '',
    annualIncome: '',
    employmentStatus: 'employed' as const,
    moveInDate: '2026-03-04',
    leaseDuration: 'yearly' as const,
  },
  preferences: {
    propertyTypes: ['house'],
    maxRent: '',
    priceUnit: 'month' as const,
    minBedrooms: '',
    minBathrooms: '',
    preferredAmenities: [],
    petFriendly: true,
    smokingAllowed: false,
    furnished: false,
    parkingRequired: false,
    accessibility: false,
  },
  settings: {
    notifications: { email: true, push: false, sms: false, propertyAlerts: true, viewingReminders: true, leaseUpdates: true },
    privacy: { profileVisibility: 'public' as const, showContactInfo: true, showIncome: false, showRentalHistory: false, showReferences: false },
    language: 'en',
    timezone: 'UTC',
    currency: 'USD',
  },
  references: [{ name: 'A', relationship: 'landlord' as const, phone: '+34 600 111 222', email: '' }],
  rentalHistory: [
    {
      address: 'x',
      startDate: '2024-01-01',
      endDate: '',
      monthlyRent: '',
      reasonForLeaving: 'other' as const,
      landlordContact: { name: '', phone: '600', email: '' },
    },
  ],
  updatePersonalInfo: noop,
  updatePreferences: noop,
  updateSettings: noop,
  toggleAmenity: noop,
  togglePropertyType: noop,
  addReference: noop,
  updateReference: noop,
  removeReference: noop,
  addRentalHistory: noop,
  updateRentalHistory: noop,
  removeRentalHistory: noop,
};

describe('profile edit form on Bloom', () => {
  it.each(['personal', 'preferences', 'references', 'rental-history', 'settings'])('renders %s', (section) => {
    const view = render(
      <SafeAreaProvider initialMetrics={metrics}><BloomThemeProvider>
        <PersonalProfileSections activeSection={section} {...props} />
      </BloomThemeProvider></SafeAreaProvider>,
    );
    expect(view.toJSON()).toBeTruthy();
  });

  it('renders a notification item', () => {
    const view = render(
      <SafeAreaProvider initialMetrics={metrics}><BloomThemeProvider>
        <NotificationItem type="property" title="t" description="d" time="now" read={false} onDelete={noop} />
      </BloomThemeProvider></SafeAreaProvider>,
    );
    expect(view.toJSON()).toBeTruthy();
  });

  it('round-trips phones and dates', () => {
    expect(splitPhone('+34 600 111 222')).toEqual({ iso2: 'ES', number: '600 111 222' });
    expect(splitPhone('+1 415 555', 'CA')).toEqual({ iso2: 'CA', number: '415 555' });
    expect(splitPhone('600')).toEqual({ iso2: 'ES', number: '600' });
    expect(joinPhone({ iso2: 'ES', name: 'Spain', dial: '34' }, '600 111')).toBe('+34 600 111');
    expect(joinPhone({ iso2: 'ES', name: 'Spain', dial: '34' }, '')).toBe('');
    expect(formatDateInput(parseDateInput('2026-03-04'))).toBe('2026-03-04');
  });
});
