import React, { type ErrorInfo, type ReactNode, useCallback, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  type AccessibilityRole,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { useMediaQuery } from 'react-responsive';

import { ErrorBoundary as BloomErrorBoundary } from '@oxyhq/bloom';
import { Button } from '@oxyhq/bloom/button';
import { H2, P, Text as BloomText } from '@oxyhq/bloom/typography';
import { toast } from '@/lib/sonner';

import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showErrorDetails?: boolean;
  maxRetries?: number;
}

/**
 * App-wide error boundary. Delegates the catching mechanics to Bloom's
 * `ErrorBoundary` (so the React class semantics stay battle-tested upstream)
 * and renders Homiio's rich fallback via the render-prop API added in
 * `@oxyhq/bloom@0.6.0`.
 */
const ErrorBoundary = ({
  children,
  fallback,
  onError,
  showErrorDetails = true,
  maxRetries = 3,
}: Props) => {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    // Log in development; production reporting (PostHog/Sentry) lives in onError.
    if (__DEV__) {
      console.error('ErrorBoundary:', {
        message: error.message,
        name: error.name,
        componentStack: errorInfo.componentStack,
        platform: Platform.OS,
      });
    }
    onError?.(error, errorInfo);
  };

  return (
    <BloomErrorBoundary
      onError={handleError}
      fallback={
        fallback !== undefined
          ? fallback
          : ({ error, errorInfo, retry, retryCount }) => (
              <ErrorFallback
                error={error}
                errorInfo={errorInfo}
                retry={retry}
                retryCount={retryCount}
                maxRetries={maxRetries}
                showErrorDetails={showErrorDetails}
              />
            )
      }>
      {children}
    </BloomErrorBoundary>
  );
};

interface ErrorFallbackProps {
  error: Error;
  errorInfo: ErrorInfo | null;
  retry: () => void;
  retryCount: number;
  maxRetries: number;
  showErrorDetails: boolean;
}

/**
 * Web-only accessibility props passed through to the alert region so screen
 * readers announce the fallback immediately. Native View doesn't support
 * `role`/`aria-live` directly — we use the dedicated RN props there.
 */
const ALERT_ROLE: AccessibilityRole = 'alert';

/**
 * Rich fallback UI rendered when an error is caught. Co-located with the
 * boundary because it is intimately tied to the error context shape.
 *
 * Layout follows the Airbnb-2026 / Homiio brand language — centered card,
 * generous spacing, soft danger badge for the icon, Bloom typography and
 * buttons throughout. Tapping the badge is a deliberate delight escape
 * hatch: it collapses any expanded technical details back to the calm
 * default state.
 */
function ErrorFallback({
  error,
  errorInfo,
  retry,
  retryCount,
  maxRetries,
  showErrorDetails,
}: ErrorFallbackProps) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const [badgePressed, setBadgePressed] = useState(false);
  const [errorIdPressed, setErrorIdPressed] = useState(false);
  const [detailsTogglePressed, setDetailsTogglePressed] = useState(false);
  const isWide = useMediaQuery({ minWidth: 768 });
  // Mirror state into a ref so the report generator stays current without
  // re-running on every state change.
  const showDetailsRef = useRef(showDetails);
  showDetailsRef.current = showDetails;

  // Stable id per error instance — `error` identity changes when the boundary
  // catches a fresh throw, so this re-derives correctly without effects.
  const errorId = React.useMemo(
    () => `ERR_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    [error],
  );

  const handleRetry = useCallback(() => {
    if (retryCount >= maxRetries) {
      // Use sonner-native/sonner toasts instead of native Alert — the
      // alert region is announced once on mount; toasts handle the "still
      // not working" follow-up without yanking focus.
      toast(t('error.boundary.maxRetriesTitle'), {
        description: t('error.boundary.maxRetriesMessage'),
        action: {
          label: t('error.boundary.forceRetry'),
          onClick: retry,
        },
      });
      return;
    }
    retry();
  }, [retry, retryCount, maxRetries, t]);

  const handleCopyErrorId = useCallback(async () => {
    try {
      await Clipboard.setStringAsync(errorId);
      toast.success(t('error.boundary.copiedToClipboard'));
    } catch {
      toast.error(t('error.boundary.reportFailedMessage'));
    }
  }, [errorId, t]);

  const handleReportIssue = useCallback(async () => {
    const errorReport = generateErrorReport({ error, errorInfo, errorId });

    try {
      await Clipboard.setStringAsync(errorReport);
      toast.success(t('error.boundary.reportCopiedTitle'), {
        description: t('error.boundary.reportCopiedMessage'),
      });
    } catch {
      toast.error(t('error.boundary.reportFailedTitle'), {
        description: t('error.boundary.reportFailedMessage'),
      });
    }
  }, [error, errorInfo, errorId, t]);

  const handleBadgePress = useCallback(() => {
    // Small delight: tapping the badge resets the disclosure state so the
    // user can re-collapse a noisy details panel without scrolling back up.
    if (showDetailsRef.current) {
      setShowDetails(false);
    }
  }, []);

  // Web gets `role="alert"` + `aria-live="assertive"`; native uses the
  // dedicated `accessibilityLiveRegion` / `accessibilityRole` props. Bundle
  // both so the same JSX works everywhere without conditional rendering.
  const a11yAlertProps = Platform.select<Record<string, unknown>>({
    web: { role: 'alert', 'aria-live': 'assertive', 'aria-atomic': 'true' },
    default: {
      accessibilityRole: ALERT_ROLE,
      accessibilityLiveRegion: 'assertive' as const,
    },
  });

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      style={styles.scrollRoot}
      keyboardShouldPersistTaps="handled">
      <View
        {...a11yAlertProps}
        style={[styles.card, isWide && styles.cardWide, isWide && withShadow('lg')]}>
        <Pressable
          onPress={handleBadgePress}
          onPressIn={() => setBadgePressed(true)}
          onPressOut={() => setBadgePressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('error.boundary.title')}
          style={[styles.iconBadge, badgePressed && styles.iconBadgePressed]}>
          <Ionicons name="alert-circle-outline" size={56} color={colors.danger} />
        </Pressable>

        <H2 style={styles.title} accessibilityRole="header">
          {t('error.boundary.title')}
        </H2>
        <P style={styles.message}>{t('error.boundary.message')}</P>

        <Pressable
          onPress={handleCopyErrorId}
          onPressIn={() => setErrorIdPressed(true)}
          onPressOut={() => setErrorIdPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('error.boundary.copyIdHint')}
          accessibilityHint={errorId}
          style={[styles.errorIdChip, errorIdPressed && styles.errorIdChipPressed]}>
          <BloomText style={styles.errorIdLabel}>{t('error.boundary.errorId')}</BloomText>
          <BloomText style={styles.errorIdValue}>{errorId}</BloomText>
          <Ionicons name="copy-outline" size={12} color={colors.muted} style={styles.errorIdCopyIcon} />
        </Pressable>

        <View style={[styles.actions, isWide && styles.actionsWide]}>
          <View style={isWide ? styles.actionWide : styles.actionFull}>
            <Button
              variant="primary"
              size="large"
              onPress={handleRetry}
              icon={<Ionicons name="refresh" size={18} color={colors.primaryLight} style={styles.buttonIconLeading} />}
              iconPosition="left"
              accessibilityLabel={t('error.boundary.retry')}
              style={styles.button}>
              {retryCount > 0
                ? `${t('error.boundary.retry')}  (${retryCount}/${maxRetries})`
                : t('error.boundary.retry')}
            </Button>
          </View>
          <View style={isWide ? styles.actionWide : styles.actionFull}>
            <Button
              variant="ghost"
              size="large"
              onPress={handleReportIssue}
              icon={
                <Ionicons name="bug-outline" size={18} color={colors.primaryColor} style={styles.buttonIconLeading} />
              }
              iconPosition="left"
              accessibilityLabel={t('error.boundary.reportIssue')}
              style={styles.button}>
              {t('error.boundary.reportIssue')}
            </Button>
          </View>
        </View>

        {showErrorDetails && (
          <Pressable
            onPress={() => setShowDetails((prev) => !prev)}
            onPressIn={() => setDetailsTogglePressed(true)}
            onPressOut={() => setDetailsTogglePressed(false)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
            style={[styles.detailsToggle, detailsTogglePressed && styles.detailsTogglePressed]}>
            <BloomText style={styles.detailsToggleText}>
              {showDetails ? t('error.boundary.hideDetails') : t('error.boundary.showDetails')}
            </BloomText>
            <Ionicons
              name={showDetails ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={colors.muted}
            />
          </Pressable>
        )}

        {showErrorDetails && showDetails && (
          <View style={styles.details}>
            <BloomText style={styles.detailsTitle}>
              {t('error.boundary.technicalDetails')}
            </BloomText>

            <DetailRow label={t('error.boundary.errorMessage')} value={error.message || '—'} mono />
            <DetailRow label={t('error.boundary.errorType')} value={error.name || '—'} mono />

            {error.stack ? (
              <DetailBlock label={t('error.boundary.stackTrace')} value={error.stack} />
            ) : null}
            {errorInfo?.componentStack ? (
              <DetailBlock label={t('error.boundary.componentStack')} value={errorInfo.componentStack} />
            ) : null}

            <View style={styles.deviceBlock}>
              <BloomText style={styles.detailLabel}>{t('error.boundary.deviceInformation')}</BloomText>
              <BloomText style={styles.deviceLine}>
                {`Platform: ${Platform.OS} ${Platform.Version ?? ''}`.trim()}
              </BloomText>
              <BloomText style={styles.deviceLine}>
                {`Device: ${Device.brand ?? 'unknown'} ${Device.modelName ?? ''}`.trim()}
              </BloomText>
              <BloomText style={styles.deviceLine}>
                {`OS: ${Device.osName ?? 'unknown'} ${Device.osVersion ?? ''}`.trim()}
              </BloomText>
              <BloomText style={styles.deviceLine}>
                {`App: ${Constants.expoConfig?.version ?? 'unknown'}`}
              </BloomText>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
}

function DetailRow({ label, value, mono }: DetailRowProps) {
  return (
    <View style={styles.detailRow}>
      <BloomText style={styles.detailLabel}>{label}</BloomText>
      <BloomText style={mono ? styles.detailValueMono : styles.detailValue}>{value}</BloomText>
    </View>
  );
}

interface DetailBlockProps {
  label: string;
  value: string;
}

function DetailBlock({ label, value }: DetailBlockProps) {
  return (
    <View style={styles.detailRow}>
      <BloomText style={styles.detailLabel}>{label}</BloomText>
      <ScrollView style={styles.codeBlock} nestedScrollEnabled>
        <BloomText style={styles.codeText}>{value}</BloomText>
      </ScrollView>
    </View>
  );
}

function generateErrorReport({
  error,
  errorInfo,
  errorId,
}: {
  error: Error;
  errorInfo: ErrorInfo | null;
  errorId: string;
}): string {
  return `
Error Report
============================================================

Error ID: ${errorId}
Timestamp: ${new Date().toISOString()}
App Version: ${Constants.expoConfig?.version ?? 'unknown'}
Platform: ${Platform.OS} ${Platform.Version ?? ''}

Device Information:
- Brand: ${Device.brand ?? 'unknown'}
- Model: ${Device.modelName ?? 'unknown'}
- OS: ${Device.osName ?? 'unknown'} ${Device.osVersion ?? ''}

Error Details:
- Name: ${error.name || 'Unknown'}
- Message: ${error.message || 'No message'}

Stack Trace:
${error.stack ?? 'No stack trace available'}

Component Stack:
${errorInfo?.componentStack ?? 'No component stack available'}

============================================================
Please share this report with the development team.
  `.trim();
}

const ICON_BADGE_SIZE = 96;
const CARD_MAX_WIDTH = 480;
const MONO_FONT = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const styles = StyleSheet.create({
  scrollRoot: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['5xl'],
  },
  card: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['4xl'],
  },
  cardWide: {
    maxWidth: CARD_MAX_WIDTH,
    paddingHorizontal: spacing['3xl'],
    paddingVertical: spacing['5xl'],
  },
  iconBadge: {
    width: ICON_BADGE_SIZE,
    height: ICON_BADGE_SIZE,
    borderRadius: ICON_BADGE_SIZE / 2,
    backgroundColor: colors.dangerSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBadgePressed: {
    opacity: 0.85,
  },
  title: {
    marginTop: spacing['2xl'],
    fontSize: 24,
    lineHeight: 30,
    textAlign: 'center',
    color: colors.COLOR_BLACK,
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
    color: colors.muted,
    maxWidth: 360,
  },
  errorIdChip: {
    marginTop: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.pill,
    gap: spacing.sm,
  },
  errorIdChipPressed: {
    opacity: 0.75,
  },
  errorIdLabel: {
    fontSize: 11,
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  errorIdValue: {
    fontSize: 12,
    fontFamily: MONO_FONT,
    color: colors.COLOR_BLACK,
    fontWeight: '600',
  },
  errorIdCopyIcon: {
    marginLeft: spacing.xs,
  },
  actions: {
    marginTop: spacing['3xl'],
    width: '100%',
    flexDirection: 'column',
    gap: spacing.md,
  },
  actionsWide: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  actionFull: {
    width: '100%',
  },
  actionWide: {
    minWidth: 180,
  },
  button: {
    width: '100%',
  },
  buttonIconLeading: {
    marginRight: spacing.sm,
  },
  detailsToggle: {
    marginTop: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  detailsTogglePressed: {
    opacity: 0.6,
  },
  detailsToggleText: {
    fontSize: 13,
    color: colors.muted,
    fontWeight: '500',
  },
  details: {
    marginTop: spacing.lg,
    width: '100%',
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailsTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  detailRow: {
    gap: spacing.xs,
  },
  detailLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
    color: colors.COLOR_BLACK,
  },
  detailValueMono: {
    fontSize: 13,
    color: colors.COLOR_BLACK,
    fontFamily: MONO_FONT,
  },
  codeBlock: {
    maxHeight: 160,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  codeText: {
    fontSize: 11,
    lineHeight: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontFamily: MONO_FONT,
  },
  deviceBlock: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.COLOR_BLACK_LIGHT_6,
  },
  deviceLine: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontFamily: MONO_FONT,
  },
});

export default ErrorBoundary;
