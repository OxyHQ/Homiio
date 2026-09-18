/**
 * SaveButton — save/unsave a property, with optimistic React Query updates.
 *
 * This is a STATEFUL COMPOSITION of the shared `IconButton` primitive: it owns
 * the save logic (mutation, optimistic toggle, saved count) and renders an
 * `IconButton` heart/bookmark for the chrome. The long press hands off to
 * `useOpenSaveToFolderSheet`, shared with `PropertyCard`'s own long press. The `chrome`
 * prop is a passthrough to `IconButton`'s `variant`, so every Save site inherits
 * the one shared button look:
 *  - `'ghost'`   (default) — flat transparent circle for headers/bars.
 *  - `'overlay'` — frosted-white circle for the on-photo card heart.
 *  - `'filled'`  — brand-fill circle.
 *
 * The saved count still renders (binary 0/1): a corner badge (`countDisplayMode:
 * 'badge'`, default) or inline beside the heart (`'inline'`).
 */
import React, { useState } from 'react';
import { StyleSheet, ViewStyle, View, StyleProp } from 'react-native';
import { useTranslation } from 'react-i18next';
import { RiBookmarkFill, RiBookmarkLine, RiHeartFill, RiHeartLine } from '@oxy.so/bloom/icons';
import { colors } from '@/styles/colors';
import { barIconSize, spacing } from '@/constants/styles';
import { IconButton, type IconButtonVariant } from '@/components/ui/IconButton';
import { useOpenSaveToFolderSheet } from './SaveToFolderBottomSheet';
import { Property } from '@homiio/shared-types';
import { ThemedText } from '@/components/ThemedText';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

interface SaveButtonProps {
  isSaved?: boolean; // Made optional since we'll determine this from React Query
  onPress?: () => void;
  onLongPress?: () => void;
  size?: number;
  style?: StyleProp<ViewStyle>;
  disabled?: boolean;
  /** Glyph shape. */
  variant?: 'heart' | 'bookmark';
  color?: string;
  activeColor?: string;
  showLoading?: boolean;
  isLoading?: boolean;
  // Only need the property object
  property?: Property;
  showCount?: boolean;
  countBadgeStyle?: StyleProp<ViewStyle>;
  countDisplayMode?: 'badge' | 'inline';
  /**
   * Chrome variant — passthrough to the shared `IconButton`. `'ghost'` (default)
   * for headers/bars, `'overlay'` for the on-photo card heart, `'filled'` for a
   * brand-fill button. The old cream-filled/shadowed chrome is gone; the on-photo
   * frosted-white look is `'overlay'`.
   */
  chrome?: IconButtonVariant;
}

export function SaveButton({
  isSaved: propIsSaved,
  onPress,
  onLongPress,
  size,
  style,
  disabled = false,
  variant = 'heart',
  color = colors.COLOR_BLACK,
  activeColor = colors.error,
  showLoading = true,
  isLoading = false,
  // Only need the property object
  property,
  showCount = false,
  countBadgeStyle,
  countDisplayMode = 'badge',
  chrome = 'ghost',
}: SaveButtonProps) {
  const { t } = useTranslation();
  const [isPressed, setIsPressed] = useState(false);
  const openSaveToFolderSheet = useOpenSaveToFolderSheet();
  // Ghost (header/bar) hearts match the shared bar glyph size; other chromes
  // scale with the caller's `size` (default 24 for the roomier card heart).
  const effectiveSize = size ?? (chrome === 'ghost' ? barIconSize : 24);
  const sizeAll = Math.max(10, effectiveSize);

  // Use SavedPropertiesContext for all state management
  const {
    savePropertyToFolder,
    unsaveProperty,
    isPropertySaved,
    isPropertySaving,
    isInitialized,
  } = useSavedPropertiesContext();

  // Determine property ID
  const propertyId = property?.id;

  // Determine initial saved state from prop or property object
  const initialSavedState =
    typeof propIsSaved === 'boolean'
      ? propIsSaved
      : (property as Property & { isSaved?: boolean })?.isSaved;

  // Use context state when initialized, otherwise fall back to initial state
  const isSaved = propertyId
    ? isInitialized
      ? isPropertySaved(propertyId)
      : initialSavedState
    : initialSavedState;

  // Binary status: saved (1) or not saved (0). Kept for the optional count.
  const savedCount = isSaved ? 1 : 0;

  const icon =
    variant === 'heart'
      ? isSaved
        ? RiHeartFill
        : RiHeartLine
      : isSaved
        ? RiBookmarkFill
        : RiBookmarkLine;

  const isSaving = Boolean(propertyId && isPropertySaving(propertyId));
  const loading = showLoading && (isLoading || isSaving);
  const isButtonDisabled = disabled || isLoading || isPressed || isSaving;

  const handleInternalSave = async () => {
    if (!propertyId) return;

    try {
      if (isSaved) {
        await unsaveProperty(propertyId);
      } else {
        await savePropertyToFolder(propertyId, null, property);
      }
    } catch (error) {
      console.error('Failed to toggle save:', error);
      throw error;
    }
  };

  const handlePress = () => {
    if (isButtonDisabled) return;

    setIsPressed(true);

    if (propertyId) {
      handleInternalSave()
        .catch((error) => {
          console.error('Save operation failed:', error);
        })
        .finally(() => {
          setIsPressed(false);
        });
    } else if (onPress) {
      onPress();
      setIsPressed(false);
    }
  };

  const handleLongPress = () => {
    if (isButtonDisabled) return;

    // If custom onLongPress is provided, use it
    if (onLongPress) {
      onLongPress();
      return;
    }

    // `useOpenSaveToFolderSheet` owns the save-then-open sequence, so a long
    // press here and a long press on a `PropertyCard` reach the same sheet in
    // the same state.
    if (!propertyId || !property) return;
    void openSaveToFolderSheet(property, String(propertyId)).finally(() => setIsPressed(false));
  };

  const accessibilityLabel = isSaved
    ? t('saved.remove', 'Remove from saved')
    : t('saved.add', 'Save');

  // Corner-badge count (default display mode) — rendered in the button's badge
  // slot as a small pill.
  const badgeCount =
    showCount && savedCount > 0 && countDisplayMode === 'badge' ? (
      <View style={[styles.countBadge, { backgroundColor: activeColor }, countBadgeStyle]}>
        <ThemedText style={styles.countBadgeText}>
          {savedCount > 99 ? '99+' : savedCount}
        </ThemedText>
      </View>
    ) : undefined;

  const button = (
    <IconButton
      icon={icon}
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityLabel={accessibilityLabel}
      disabled={isButtonDisabled}
      variant={chrome}
      size={sizeAll}
      color={color}
      active={isSaved}
      activeColor={activeColor}
      loading={loading}
      badge={badgeCount}
      // Inline mode positions the wrapper below; otherwise the caller's `style`
      // (e.g. the card heart's absolute positioning) rides on the button itself.
      style={countDisplayMode === 'inline' ? undefined : style}
    />
  );

  // Inline count — the number sits beside the button (the button keeps its own
  // chrome; the wrapper takes the caller's positioning `style`).
  if (showCount && savedCount > 0 && countDisplayMode === 'inline') {
    return (
      <View style={[styles.inlineWrap, style]}>
        {button}
        <ThemedText style={[styles.inlineCount, { fontSize: sizeAll, color: isSaved ? activeColor : color }]}>
          {savedCount > 99 ? '99+' : savedCount}
        </ThemedText>
      </View>
    );
  }

  return button;
}

const styles = StyleSheet.create({
  countBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: colors.primaryLight,
  },
  countBadgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  inlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  inlineCount: {
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
