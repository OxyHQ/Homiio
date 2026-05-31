/**
 * PropertyFeatures — property-detail "Property Features".
 *
 * Mirrors the "What this place offers" (AmenitiesGrid) look exactly: a flat,
 * hairline-free `DetailIconGrid` of "icon + label" rows, each rendering an
 * isometric PNG (via `getIconArt`) when art exists, else its Ionicons line
 * glyph — both via the shared `DetailIcon`, so PNG rows and line-icon rows
 * align identically. No pills.
 *
 * Rows list what the place HAS (like amenities), not present/absent toggles:
 *   - Furnished   always shown when `furnishedStatus` is defined (label varies
 *                 by status). PNG `furnished`, fallback `cube`.
 *   - Balcony     shown only when `hasBalcony`. PNG `balcony`, fallback `home`.
 *   - Garden      shown only when `hasGarden`. Ionicons `leaf` (no PNG yet).
 *   - Elevator    shown only when `hasElevator`. PNG `elevator`, fallback
 *                 `arrow-up-circle`.
 * No rows → renders nothing.
 */
import React, { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Section } from '@/components/property/Section';
import {
    DetailIcon,
    DetailIconCell,
    DetailIconGrid,
    DetailIconRow,
} from '@/components/property/DetailIconGrid';
import { getIconArt } from '@/constants/amenities';

type FurnishedStatus = 'furnished' | 'partially_furnished' | 'unfurnished';

interface Props {
    property?: {
        furnishedStatus?: FurnishedStatus;
        hasBalcony?: boolean;
        hasGarden?: boolean;
        hasElevator?: boolean;
    } | null;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface FeatureRow {
    key: string;
    label: string;
    /** Amenity catalog id to resolve a PNG; `undefined` ⇒ always use the glyph. */
    imageId?: string;
    /** Fallback (or sole) Ionicons glyph when no PNG resolves. */
    icon: IoniconName;
}

/**
 * One feature line: PNG-or-Ionicons + label. Mirrors AmenitiesGrid's
 * `AmenityRow` (same icon box + fallback) and delegates layout to the shared
 * `DetailIconRow` so it can't drift from the amenities grid.
 */
const FeatureIconRow: React.FC<FeatureRow> = ({ label, imageId, icon }) => (
    <DetailIconRow
        icon={<DetailIcon image={imageId ? getIconArt(imageId) : undefined} fallbackIcon={icon} />}
        label={label}
    />
);

export const PropertyFeatures: React.FC<Props> = ({ property }) => {
    const { t } = useTranslation();
    const furnishedStatus = property?.furnishedStatus;
    const hasBalcony = property?.hasBalcony;
    const hasGarden = property?.hasGarden;
    const hasElevator = property?.hasElevator;

    const rows = useMemo<FeatureRow[]>(() => {
        const next: FeatureRow[] = [];

        if (furnishedStatus !== undefined) {
            const label =
                furnishedStatus === 'furnished'
                    ? t('Furnished')
                    : furnishedStatus === 'partially_furnished'
                        ? t('Partially Furnished')
                        : t('Unfurnished');
            next.push({ key: 'furnished', label, imageId: 'furnished', icon: 'cube' });
        }
        if (hasBalcony === true) {
            next.push({ key: 'balcony', label: t('Balcony'), imageId: 'balcony', icon: 'home' });
        }
        if (hasGarden === true) {
            next.push({ key: 'garden', label: t('Garden'), icon: 'leaf' });
        }
        if (hasElevator === true) {
            next.push({
                key: 'elevator',
                label: t('Elevator'),
                imageId: 'elevator',
                icon: 'arrow-up-circle',
            });
        }

        return next;
    }, [furnishedStatus, hasBalcony, hasGarden, hasElevator, t]);

    if (rows.length === 0) return null;

    return (
        <Section title={t('Property Features')}>
            <DetailIconGrid>
                {rows.map((row) => (
                    <DetailIconCell key={row.key}>
                        <FeatureIconRow {...row} />
                    </DetailIconCell>
                ))}
            </DetailIconGrid>
        </Section>
    );
};

export default PropertyFeatures;
