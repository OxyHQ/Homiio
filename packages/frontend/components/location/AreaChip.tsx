/**
 * The area a list is scoped to, as a Bloom `Chip` in its filter row, with the
 * picker behind it (#353).
 *
 * For a surface with no search bar of its own — the eviction board — this is
 * the "where?" control: the chip STATES the area ("Near Madrid · 25 km",
 * "Everywhere", "Choose an area", "Finding where you are…") and pressing it
 * opens the same panel Home's Where segment opens — "Use my location" (disabled
 * with the reason when location is off), the last area, "Explore everywhere",
 * and typed places. The words and row states come from `./scopeWhere`, so this
 * chip and Home's bar cannot state one area two ways.
 *
 * `open` is controlled so the surface's own empty state can open the picker.
 */
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Chip } from '@oxy.so/bloom/chip';
import { Dialog } from '@oxy.so/bloom/dialog';
import { RiArrowDownSLine, RiMapPinLine } from '@oxy.so/bloom/icons';

import type { LocationSelection } from '@homiio/shared-types';

import { WhereStep } from '@/components/search/steps/WhereStep';
import type { LocationScope } from '@/hooks/useLocationScope';
import { useColors } from '@/hooks/useThemeColor';

import { useScopeWhere } from './useScopeWhere';

/** The dialog width the picker opens at on a wide screen. */
const PICKER_MAX_WIDTH = 520;
const ICON_SIZE = 16;

export interface AreaChipProps {
  scope: LocationScope;
  /** The picker's heading. Default: "Where are you looking for a home?". */
  title?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  testID?: string;
}

export function AreaChip({ scope, title, open, onOpenChange, testID }: AreaChipProps): React.ReactElement {
  const { t } = useTranslation();
  const colors = useColors();
  const [text, setText] = useState('');
  const where = useScopeWhere(scope, scope.selection);
  const { value, placeholder } = where.statement;
  const label = value ?? placeholder;

  const close = useCallback(() => {
    setText('');
    onOpenChange(false);
  }, [onOpenChange]);

  const choose = useCallback(
    (selection: LocationSelection) => {
      scope.choose(selection);
      close();
    },
    [scope, close],
  );

  return (
    <>
      <Chip
        variant={value ? 'outlined' : 'subtle'}
        size="large"
        startIcon={<RiMapPinLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.text} />}
        endIcon={<RiArrowDownSLine width={ICON_SIZE} height={ICON_SIZE} fill={colors.textSecondary} />}
        onPress={() => onOpenChange(true)}
        accessibilityLabel={`${t('location.scope.announce', { scope: label })}. ${t('location.scope.changeAccessible')}`}
        testID={testID}
      >
        {label}
      </Chip>

      <Dialog
        placement={{ base: 'bottom', md: 'center' }}
        open={open}
        onClose={close}
        title={title ?? t('location.scope.pickerTitle')}
        label={title ?? t('location.scope.pickerTitle')}
        maxWidth={PICKER_MAX_WIDTH}
      >
        <WhereStep
          value={text}
          onChangeText={setText}
          onSelectLocation={choose}
          options={{
            device: {
              ...where.device,
              onPress: () => {
                scope.useCurrentLocation();
                close();
              },
            },
            lastArea: where.lastArea,
            onEverywhere: scope.isGlobal
              ? undefined
              : () => {
                  scope.exploreGlobal();
                  close();
                },
          }}
        />
      </Dialog>
    </>
  );
}
