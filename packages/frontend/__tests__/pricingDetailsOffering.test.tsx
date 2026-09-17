/**
 * "Pricing & Costs" shows the active mode's rent only when the listing OFFERS
 * that rent. A sale listing carrying an empty `longTermRent` block used to
 * render "Monthly Rent $0" beneath its sale price.
 */
import React from 'react';
import { BloomThemeProvider } from '@oxy.so/bloom/theme';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { OfferingType, type Property } from '@homiio/shared-types';

import { PricingDetails, hasPricingDetails } from '@/components/property/PricingDetails';

jest.mock('@/components/MoneyText', () => {
  const { Text } = jest.requireActual('react-native');
  return { MoneyText: ({ amount }: { amount: number }) => <Text>{`money:${amount}`}</Text> };
});

const metrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function renderPricing(property: Partial<Property>, mode: 'long_term' | 'vacation' = 'long_term') {
  return render(
    <SafeAreaProvider initialMetrics={metrics}>
      <BloomThemeProvider>
        <PricingDetails property={property as Property} mode={mode} />
      </BloomThemeProvider>
    </SafeAreaProvider>,
  );
}

describe('PricingDetails offering gate', () => {
  it('renders nothing for a sale listing that carries an empty long-term block', () => {
    const view = renderPricing({
      offerings: [OfferingType.SALE],
      longTermRent: { monthlyAmount: 0, currency: 'USD' } as Property['longTermRent'],
    });
    expect(view.queryByText(/money:/)).toBeNull();
    expect(view.queryByText(/pricingAndCosts|Pricing & Costs/)).toBeNull();
    expect(hasPricingDetails({ offerings: [OfferingType.SALE], longTermRent: { monthlyAmount: 0 } } as unknown as Property, 'long_term')).toBe(false);
  });

  it('shows the monthly rent for a listing that offers long-term rent', () => {
    const view = renderPricing({
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 1200, currency: 'EUR', deposit: 1200 } as Property['longTermRent'],
    });
    expect(view.getAllByText('money:1200').length).toBeGreaterThan(0);
  });

  it('never shows a zero rent as a price', () => {
    const view = renderPricing({
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRent: { monthlyAmount: 0, currency: 'EUR', deposit: 500 } as Property['longTermRent'],
    });
    expect(view.queryByText('money:0')).toBeNull();
    expect(view.getAllByText('money:500').length).toBeGreaterThan(0);
  });
});
