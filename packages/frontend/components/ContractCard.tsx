/**
 * ContractCard — a lease on the `/contracts` phone layout and in "Your home"
 * (wide web lists the same leases in a Bloom DataTable).
 *
 * Bloom's `LeaseSummaryCard`: the parties, the term and how much of it has run,
 * rent, deposit and the next payment owed, all mapped by
 * `components/tenancy/leaseTenancy.ts`. The card has no status slot and is not
 * pressable, so its action row carries the lease status chip and the "View"
 * button that opens the contract.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons';
import { LeaseSummaryCard } from '@oxy.so/bloom/tenancy';
import type { Lease } from '@homiio/shared-types';

import { ContractStatusBadge } from './ContractStatusBadge';
import { leaseSummaryProps, type LeaseFormatContext } from './tenancy/leaseTenancy';

interface ContractCardProps {
  lease: Lease;
  /** The property's display title. */
  title: string;
  /** From `useLeaseFormatContext`, resolved once for the whole list. */
  format: LeaseFormatContext;
  onPress: () => void;
}

export const ContractCard: React.FC<ContractCardProps> = ({ lease, title, format, onPress }) => {
  const { t } = useTranslation();
  return (
    <LeaseSummaryCard
      {...leaseSummaryProps(lease, title, format)}
      actions={
        <View style={styles.actions}>
          <ContractStatusBadge status={lease.status} />
          <Button
            variant="secondary"
            size="small"
            trailingIcon={RiArrowRightSLine}
            onPress={onPress}
            accessibilityLabel={t('contracts.card.accessibility', { title })}
          >
            {t('contracts.actions.view')}
          </Button>
        </View>
      }
    />
  );
};

export default ContractCard;

const styles = StyleSheet.create({
  actions: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
});
