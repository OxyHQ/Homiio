import React, { type ErrorInfo, type ReactNode, useCallback, useState } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Platform,
  Pressable,
  type AccessibilityRole,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

import { ErrorBoundary as BloomErrorBoundary } from '@oxy.so/bloom/error-boundary';
import { Button } from '@oxy.so/bloom/button';
import { H2, P, Text as BloomText } from '@oxy.so/bloom/typography';
import { toast } from '@oxy.so/bloom/toast';
import { useTheme } from '@oxy.so/bloom/theme';

import { radius, spacing } from '@/constants/styles';
import {
  RiArrowDownSLine,
  RiArrowUpSLine,
  RiErrorWarningFill,
  RiFeedbackLine,
  RiFileCopyLine,
  RiRefreshLine,
} from '@oxy.so/bloom/icons';

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
 * `@oxy.so/bloom@0.6.0`.
 */
const ErrorBoundary = ({
  children,
  fallback,
  onError,
  showErrorDetails = true,
  maxRetries = 3,
}: Props) => {
  const handleError = (error: Error, errorInfo: ErrorInfo) => {
    // Log in development; production error reporting lives in onError.
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
      }
    >
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
  const { colors } = useTheme();
  const [showDetails, setShowDetails] = useState(false);
  const [badgePressed, setBadgePressed] = useState(false);
  const [errorIdPressed, setErrorIdPressed] = useState(false);
  const [detailsTogglePressed, setDetailsTogglePressed] = useState(false);

  // Stable id per caught error. Bloom's boundary unmounts this fallback on
  // retry and mounts a fresh one for the next error it catches, so each error
  // instance gets its own mount — and its own lazily-initialized id.
  const [errorId] = useState(generateErrorId);

  const handleRetry = useCallback(() => {
    if (retryCount >= maxRetries) {
      // Use a Bloom toast instead of a native Alert — the alert region is
      // announced once on mount; toasts handle the "still not working"
      // follow-up without yanking focus.
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
    // Setting `false` when already collapsed is a no-op (React bails out), so
    // no guard is needed and we avoid mirroring state into a ref.
    setShowDetails(false);
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
    <View style={styles.content}>
      <View
        {...a11yAlertProps}
        className="bg-card px-5 py-10 md:max-w-[480px] md:border md:border-border md:px-8 md:py-14"
        style={styles.card}
      >
        <Pressable
          onPress={handleBadgePress}
          onPressIn={() => setBadgePressed(true)}
          onPressOut={() => setBadgePressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('error.boundary.title')}
          className="bg-error-subtle"
          style={[styles.iconBadge, badgePressed && styles.iconBadgePressed]}
        >
          <RiErrorWarningFill width={56} height={56} fill={colors.error} />
        </Pressable>

        <H2 style={styles.title} accessibilityRole="header">
          {t('error.boundary.title')}
        </H2>
        <P style={[styles.message, { color: colors.textSecondary }]}>
          {t('error.boundary.message')}
        </P>

        <Pressable
          onPress={handleCopyErrorId}
          onPressIn={() => setErrorIdPressed(true)}
          onPressOut={() => setErrorIdPressed(false)}
          accessibilityRole="button"
          accessibilityLabel={t('error.boundary.copyIdHint')}
          accessibilityHint={errorId}
          className="bg-muted"
          style={[styles.errorIdChip, errorIdPressed && styles.errorIdChipPressed]}
        >
          <BloomText className="text-muted-foreground" style={styles.errorIdLabel}>
            {t('error.boundary.errorId')}
          </BloomText>
          <BloomText className="font-bloom-mono text-foreground" style={styles.errorIdValue}>
            {errorId}
          </BloomText>
          <RiFileCopyLine
            width={12}
            height={12}
            fill={colors.textSecondary}
            style={styles.errorIdCopyIcon}
          />
        </Pressable>

        <View className="mt-8 w-full flex-col gap-3 md:flex-row md:justify-center md:gap-4">
          <View className="w-full md:w-auto md:min-w-[180px]">
            <Button
              size="lg"
              onPress={handleRetry}
              leadingIcon={RiRefreshLine}
              accessibilityLabel={t('error.boundary.retry')}
              style={styles.button}
              tone="accent"
              appearance="solid"
            >
              {retryCount > 0
                ? `${t('error.boundary.retry')}  (${retryCount}/${maxRetries})`
                : t('error.boundary.retry')}
            </Button>
          </View>
          <View className="w-full md:w-auto md:min-w-[180px]">
            <Button
              size="lg"
              onPress={handleReportIssue}
              leadingIcon={RiFeedbackLine}
              accessibilityLabel={t('error.boundary.reportIssue')}
              style={styles.button}
              tone="accent"
              appearance="subtle"
            >
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
            style={[styles.detailsToggle, detailsTogglePressed && styles.detailsTogglePressed]}
          >
            <BloomText className="text-muted-foreground" style={styles.detailsToggleText}>
              {showDetails ? t('error.boundary.hideDetails') : t('error.boundary.showDetails')}
            </BloomText>
            {React.createElement(showDetails ? RiArrowUpSLine : RiArrowDownSLine, {
              width: 14,
              height: 14,
              fill: colors.textSecondary,
            })}
          </Pressable>
        )}

        {showErrorDetails && showDetails && (
          <View className="bg-muted" style={styles.details}>
            <BloomText style={styles.detailsTitle}>
              {t('error.boundary.technicalDetails')}
            </BloomText>

            <DetailRow label={t('error.boundary.errorMessage')} value={error.message || '—'} mono />
            <DetailRow label={t('error.boundary.errorType')} value={error.name || '—'} mono />

            {error.stack ? (
              <DetailBlock label={t('error.boundary.stackTrace')} value={error.stack} />
            ) : null}
            {errorInfo?.componentStack ? (
              <DetailBlock
                label={t('error.boundary.componentStack')}
                value={errorInfo.componentStack}
              />
            ) : null}

            <View className="border-border" style={styles.deviceBlock}>
              <BloomText className="text-muted-foreground" style={styles.detailLabel}>
                {t('error.boundary.deviceInformation')}
              </BloomText>
              <BloomText
                className="font-bloom-mono text-muted-foreground"
                style={styles.deviceLine}
              >
                {`Platform: ${Platform.OS} ${Platform.Version ?? ''}`.trim()}
              </BloomText>
              <BloomText
                className="font-bloom-mono text-muted-foreground"
                style={styles.deviceLine}
              >
                {`Device: ${Device.brand ?? 'unknown'} ${Device.modelName ?? ''}`.trim()}
              </BloomText>
              <BloomText
                className="font-bloom-mono text-muted-foreground"
                style={styles.deviceLine}
              >
                {`OS: ${Device.osName ?? 'unknown'} ${Device.osVersion ?? ''}`.trim()}
              </BloomText>
              <BloomText
                className="font-bloom-mono text-muted-foreground"
                style={styles.deviceLine}
              >
                {`App: ${Constants.expoConfig?.version ?? 'unknown'}`}
              </BloomText>
            </View>
          </View>
        )}
      </View>
    </View>
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
      <BloomText className="text-muted-foreground" style={styles.detailLabel}>
        {label}
      </BloomText>
      <BloomText
        className={mono ? 'font-bloom-mono text-foreground' : undefined}
        style={styles.detailValue}
      >
        {value}
      </BloomText>
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
      <BloomText className="text-muted-foreground" style={styles.detailLabel}>
        {label}
      </BloomText>
      <ScrollView className="bg-card" style={styles.codeBlock} nestedScrollEnabled>
        <BloomText className="font-bloom-mono text-muted-foreground" style={styles.codeText}>
          {value}
        </BloomText>
      </ScrollView>
    </View>
  );
}

/**
 * Generates a unique, human-shareable error id. Uses impure sources, so it
 * must only ever be called from a lazy state initializer or an event handler —
 * never directly during render.
 */
function generateErrorId(): string {
  return `ERR_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing['5xl'],
  },
  card: {
    width: '100%',
    alignItems: 'center',
    borderRadius: radius.xl,
  },
  iconBadge: {
    width: ICON_BADGE_SIZE,
    height: ICON_BADGE_SIZE,
    borderRadius: ICON_BADGE_SIZE / 2,
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
  },
  message: {
    marginTop: spacing.md,
    textAlign: 'center',
    maxWidth: 360,
  },
  errorIdChip: {
    marginTop: spacing['2xl'],
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    gap: spacing.sm,
  },
  errorIdChipPressed: {
    opacity: 0.75,
  },
  errorIdLabel: {
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '600',
  },
  errorIdValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  errorIdCopyIcon: {
    marginLeft: spacing.xs,
  },
  button: {
    width: '100%',
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
    fontWeight: '500',
  },
  details: {
    marginTop: spacing.lg,
    width: '100%',
    borderRadius: radius.lg,
    padding: spacing.lg,
    gap: spacing.md,
  },
  detailsTitle: {
    fontSize: 13,
    fontWeight: '700',
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
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: 13,
  },
  codeBlock: {
    maxHeight: 160,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  codeText: {
    fontSize: 11,
    lineHeight: 16,
  },
  deviceBlock: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  deviceLine: {
    fontSize: 12,
  },
});

export default ErrorBoundary;
