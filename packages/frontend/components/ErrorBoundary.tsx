import React, { type ErrorInfo, type ReactNode, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Clipboard,
  Alert,
  Platform,
} from 'react-native';
import { colors } from '@/styles/colors';
import { useTranslation } from 'react-i18next';
import { ThemedText } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { ErrorBoundary as BloomErrorBoundary } from '@oxyhq/bloom';

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
 * Rich fallback UI rendered when an error is caught. Co-located with the
 * boundary because it is intimately tied to the error context shape.
 *
 * Uses local state for the per-mount details-disclosure toggle and a derived
 * `errorId` so each crash gets a stable identifier for the report.
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
  // Stable id per error instance — `error` identity changes when the boundary
  // catches a fresh throw, so this re-derives correctly without effects.
  const errorId = React.useMemo(
    () => `ERR_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
    [error],
  );

  const handleRetry = () => {
    if (retryCount >= maxRetries) {
      Alert.alert(
        t('error.boundary.maxRetriesTitle'),
        t('error.boundary.maxRetriesMessage'),
        [
          { text: t('error.boundary.reportIssue'), onPress: handleReportIssue },
          { text: t('error.boundary.forceRetry'), onPress: retry },
        ],
      );
      return;
    }
    retry();
  };

  const handleReportIssue = async () => {
    const errorReport = generateErrorReport({ error, errorInfo, errorId });

    try {
      await Clipboard.setString(errorReport);
      Alert.alert(
        t('error.boundary.reportCopiedTitle'),
        t('error.boundary.reportCopiedMessage'),
      );
    } catch {
      Alert.alert(
        t('error.boundary.reportFailedTitle'),
        t('error.boundary.reportFailedMessage'),
      );
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.iconContainer}>
        <Ionicons name="warning" size={64} color="#ff4444" />
      </View>

      <ThemedText style={styles.title}>{t('error.boundary.title')}</ThemedText>
      <ThemedText style={styles.message}>{t('error.boundary.message')}</ThemedText>

      <View style={styles.errorIdContainer}>
        <ThemedText style={styles.errorIdLabel}>{t('error.boundary.errorId')}:</ThemedText>
        <ThemedText style={styles.errorIdText}>{errorId}</ThemedText>
      </View>

      <View style={styles.buttonContainer}>
        <TouchableOpacity style={[styles.button, styles.retryButton]} onPress={handleRetry}>
          <Ionicons name="refresh" size={20} color="white" style={styles.buttonIcon} />
          <ThemedText style={styles.retryText}>
            {t('error.boundary.retry')}
            {retryCount > 0 && ` (${retryCount}/${maxRetries})`}
          </ThemedText>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.button, styles.reportButton]} onPress={handleReportIssue}>
          <Ionicons
            name="bug"
            size={20}
            color={colors.primaryColor}
            style={styles.buttonIcon}
          />
          <ThemedText style={styles.reportText}>{t('error.boundary.reportIssue')}</ThemedText>
        </TouchableOpacity>
      </View>

      {showErrorDetails && (
        <TouchableOpacity
          style={styles.detailsToggle}
          onPress={() => setShowDetails((prev) => !prev)}>
          <ThemedText style={styles.detailsToggleText}>
            {showDetails
              ? t('error.boundary.hideDetails')
              : t('error.boundary.showDetails')}
          </ThemedText>
          <Ionicons
            name={showDetails ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.COLOR_BLACK_LIGHT_3}
          />
        </TouchableOpacity>
      )}

      {showDetails && (
        <View style={styles.errorDetails}>
          <ThemedText style={styles.errorDetailsTitle}>
            {t('error.boundary.technicalDetails')}
          </ThemedText>

          <View style={styles.errorSection}>
            <ThemedText style={styles.errorSectionTitle}>Error Message:</ThemedText>
            <ThemedText style={styles.errorText}>{error.message || 'Unknown error'}</ThemedText>
          </View>

          <View style={styles.errorSection}>
            <ThemedText style={styles.errorSectionTitle}>Error Type:</ThemedText>
            <ThemedText style={styles.errorText}>{error.name || 'Unknown'}</ThemedText>
          </View>

          {error.stack && (
            <View style={styles.errorSection}>
              <ThemedText style={styles.errorSectionTitle}>Stack Trace:</ThemedText>
              <ScrollView style={styles.stackContainer} nestedScrollEnabled>
                <ThemedText style={styles.stackText}>{error.stack}</ThemedText>
              </ScrollView>
            </View>
          )}

          {errorInfo?.componentStack && (
            <View style={styles.errorSection}>
              <ThemedText style={styles.errorSectionTitle}>Component Stack:</ThemedText>
              <ScrollView style={styles.stackContainer} nestedScrollEnabled>
                <ThemedText style={styles.stackText}>{errorInfo.componentStack}</ThemedText>
              </ScrollView>
            </View>
          )}

          <View style={styles.deviceInfo}>
            <ThemedText style={styles.errorSectionTitle}>Device Information:</ThemedText>
            <ThemedText style={styles.deviceInfoText}>
              Platform: {Platform.OS} {Platform.Version || ''}
            </ThemedText>
            <ThemedText style={styles.deviceInfoText}>
              Device: {Device.brand || 'unknown'} {Device.modelName || ''}
            </ThemedText>
            <ThemedText style={styles.deviceInfoText}>
              OS: {Device.osName || 'unknown'} {Device.osVersion || ''}
            </ThemedText>
            <ThemedText style={styles.deviceInfoText}>
              App Version: {Constants.expoConfig?.version || 'unknown'}
            </ThemedText>
          </View>
        </View>
      )}
    </ScrollView>
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
App Version: ${Constants.expoConfig?.version || 'unknown'}
Platform: ${Platform.OS} ${Platform.Version || ''}

Device Information:
- Brand: ${Device.brand || 'unknown'}
- Model: ${Device.modelName || 'unknown'}
- OS: ${Device.osName || 'unknown'} ${Device.osVersion || ''}

Error Details:
- Name: ${error.name || 'Unknown'}
- Message: ${error.message || 'No message'}

Stack Trace:
${error.stack || 'No stack trace available'}

Component Stack:
${errorInfo?.componentStack || 'No component stack available'}

============================================================
Please share this report with the development team.
  `.trim();
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#fafafa',
  },
  iconContainer: {
    marginBottom: 20,
    padding: 15,
    backgroundColor: 'rgba(255, 68, 68, 0.1)',
    borderRadius: 50,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 10,
    color: colors.primaryColor,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 24,
    maxWidth: 300,
  },
  errorIdContainer: {
    backgroundColor: '#f5f5f5',
    padding: 10,
    borderRadius: 8,
    marginBottom: 20,
    alignItems: 'center',
  },
  errorIdLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginBottom: 4,
  },
  errorIdText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buttonContainer: {
    width: '100%',
    maxWidth: 300,
    gap: 12,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    minHeight: 48,
  },
  retryButton: {
    backgroundColor: colors.primaryColor,
  },
  reportButton: {
    backgroundColor: 'white',
    borderWidth: 2,
    borderColor: colors.primaryColor,
  },
  buttonIcon: {
    marginRight: 8,
  },
  retryText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  reportText: {
    color: colors.primaryColor,
    fontSize: 16,
    fontWeight: '600',
  },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    marginTop: 10,
  },
  detailsToggleText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginRight: 5,
  },
  errorDetails: {
    width: '100%',
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  errorDetailsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 15,
    textAlign: 'center',
  },
  errorSection: {
    marginBottom: 15,
  },
  errorSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
  },
  errorText: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    backgroundColor: '#f8f8f8',
    padding: 10,
    borderRadius: 6,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 18,
  },
  stackContainer: {
    maxHeight: 150,
    backgroundColor: '#f8f8f8',
    borderRadius: 6,
    padding: 10,
  },
  stackText: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    lineHeight: 16,
  },
  deviceInfo: {
    backgroundColor: '#f0f7ff',
    padding: 12,
    borderRadius: 8,
    borderLeftWidth: 4,
    borderLeftColor: colors.primaryColor,
  },
  deviceInfoText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 4,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
});

export default ErrorBoundary;
