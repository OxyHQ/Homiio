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
 *   - Parking     shown when `parkingType` is set and not `none` (label varies
 *                 by kind: garage / assigned / street). PNG `parking`, fallback `car`.
 *   - Pets        shown when `petPolicy` is set (allowed / not_allowed / case_by_case).
 *                 Ionicons `paw`.
 * All labels come from the shared `parkingType.*` / `petPolicy.*` enum vocab.
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
import { getIconArt } from '@/constants/iconArt';

type FurnishedStatus = 'furnished' | 'partially_furnished' | 'unfurnished';
type ParkingType = 'none' | 'street' | 'assigned' | 'garage';
type PetPolicy = 'allowed' | 'not_allowed' | 'case_by_case';

interface Props {
    property?: {
        furnishedStatus?: FurnishedStatus;
        hasBalcony?: boolean;
        hasGarden?: boolean;
        hasElevator?: boolean;
        parkingType?: ParkingType;
        petPolicy?: PetPolicy;
    } | null;
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface FeatureRowData {
    label: string;
    /** Amenity catalog id to resolve a PNG; `undefined` ⇒ always use the glyph. */
    imageId?: string;
    /** Fallback (or sole) Ionicons glyph when no PNG resolves. */
    icon: IoniconName;
}

/** Keyed variant used only for the list; `key` is consumed by the cell, never the row. */
interface FeatureRow extends FeatureRowData {
    key: string;
}

/**
 * One feature line: PNG-or-Ionicons + label. Mirrors AmenitiesGrid's
 * `AmenityRow` (same icon box + fallback) and delegates layout to the shared
 * `DetailIconRow` so it can't drift from the amenities grid.
 */
const FeatureIconRow: React.FC<FeatureRowData> = ({ label, imageId, icon }) => (
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
    const parkingType = property?.parkingType;
    const petPolicy = property?.petPolicy;

    const rows = useMemo<FeatureRow[]>(() => {
        const next: FeatureRow[] = [];

        if (furnishedStatus !== undefined) {
            const label =
                furnishedStatus === 'furnished'
                    ? t('property.sections.furnished')
                    : furnishedStatus === 'partially_furnished'
                        ? t('property.sections.partiallyFurnished')
                        : t('property.sections.unfurnished');
            next.push({ key: 'furnished', label, imageId: 'furnished', icon: 'cube' });
        }
        if (hasBalcony === true) {
            next.push({ key: 'balcony', label: t('property.sections.balcony'), imageId: 'balcony', icon: 'home' });
        }
        if (hasGarden === true) {
            next.push({ key: 'garden', label: t('property.sections.garden'), icon: 'leaf' });
        }
        if (hasElevator === true) {
            next.push({
                key: 'elevator',
                label: t('property.sections.elevator'),
                imageId: 'elevator',
                icon: 'arrow-up-circle',
            });
        }
        if (parkingType !== undefined && parkingType !== 'none') {
            next.push({
                key: 'parking',
                label: t(`parkingType.${parkingType}`),
                imageId: 'parking',
                icon: 'car',
            });
        }
        if (petPolicy !== undefined) {
            next.push({ key: 'petPolicy', label: t(`petPolicy.${petPolicy}`), icon: 'paw' });
        }

        return next;
    }, [furnishedStatus, hasBalcony, hasGarden, hasElevator, parkingType, petPolicy, t]);

    if (rows.length === 0) return null;

    return (
        <Section title={t('property.sections.features')}>
            <DetailIconGrid>
                {rows.map(({ key, ...data }) => (
                    <DetailIconCell key={key}>
                        <FeatureIconRow {...data} />
                    </DetailIconCell>
                ))}
            </DetailIconGrid>
        </Section>
    );
};

export default PropertyFeatures;
