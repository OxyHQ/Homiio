import React, { Component, ErrorInfo, ReactNode } from 'react';
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
import { withTranslation } from 'react-i18next';
import { ThemedText } from './ThemedText';
import { Ionicons } from '@expo/vector-icons';
import * as Device from 'expo-device';
import Constants from 'expo-constants';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  showErrorDetails?: boolean;
  maxRetries?: number;
  t: (key: string) => string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  retryCount: number;
  showDetails: boolean;
  errorId: string;
}

class ErrorBoundaryBase extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    retryCount: 0,
    showDetails: false,
    errorId: '',
  };

  static getDerivedStateFromError(error: Error): State {
    const errorId = `ERR_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    return {
      hasError: true,
      error,
      errorInfo: null,
      retryCount: 0,
      showDetails: false,
      errorId,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo);

    // Update state with error info
    this.setState({ errorInfo });

    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo);

    // Log error details for debugging
    this.logErrorDetails(error, errorInfo);
  }

  private logErrorDetails = (error: Error, errorInfo: ErrorInfo) => {
    // Only log detailed errors in development
    if (__DEV__) {
      const errorDetails = {
        errorId: this.state.errorId,
        message: error.message,
        name: error.name,
        componentStack: errorInfo.componentStack,
        platform: Platform.OS,
      };
      console.error('ErrorBoundary:', errorDetails);
    }
    // In production, send to error reporting service (PostHog, Sentry, etc.)
  };

  private handleRetry = () => {
    const { maxRetries = 3 } = this.props;
    const newRetryCount = this.state.retryCount + 1;

    if (newRetryCount > maxRetries) {
      Alert.alert(
        this.props.t('error.boundary.maxRetriesTitle'),
        this.props.t('error.boundary.maxRetriesMessage'),
        [
          {
            text: this.props.t('error.boundary.reportIssue'),
            onPress: this.handleReportIssue,
          },
          {
            text: this.props.t('error.boundary.forceRetry'),
            onPress: this.handleForceRetry,
          },
        ],
      );
      return;
    }

    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: newRetryCount,
      showDetails: false,
    });
  };

  private handleForceRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      retryCount: 0,
      showDetails: false,
      errorId: '',
    });
  };

  private handleToggleDetails = () => {
    this.setState({ showDetails: !this.state.showDetails });
  };

  private handleReportIssue = async () => {
    const errorReport = this.generateErrorReport();

    try {
      await Clipboard.setString(errorReport);
      Alert.alert(
        this.props.t('error.boundary.reportCopiedTitle'),
        this.props.t('error.boundary.reportCopiedMessage'),
      );
    } catch {
      Alert.alert(
        this.props.t('error.boundary.reportFailedTitle'),
        this.props.t('error.boundary.reportFailedMessage'),
      );
    }
  };

  private generateErrorReport = (): string => {
    const { error, errorInfo, errorId } = this.state;

    return `
🚨 Error Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Error ID: ${errorId}
Timestamp: ${new Date().toISOString()}
App Version: ${Constants.expoConfig?.version || 'unknown'}
Platform: ${Platform.OS} ${Platform.Version || ''}

Device Information:
• Brand: ${Device.brand || 'unknown'}
• Model: ${Device.modelName || 'unknown'}
• OS: ${Device.osName || 'unknown'} ${Device.osVersion || ''}

Error Details:
• Name: ${error?.name || 'Unknown'}
• Message: ${error?.message || 'No message'}

Stack Trace:
${error?.stack || 'No stack trace available'}

Component Stack:
${errorInfo?.componentStack || 'No component stack available'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Please share this report with the development team.
        `.trim();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const { error, errorInfo, showDetails, retryCount, errorId } = this.state;
      const { maxRetries = 3, showErrorDetails = true } = this.props;

      return (
        <ScrollView contentContainerStyle={styles.container}>
          <View style={styles.iconContainer}>
            <Ionicons name="warning" size={64} color="#ff4444" />
          </View>

          <ThemedText style={styles.title}>{this.props.t('error.boundary.title')}</ThemedText>

          <ThemedText style={styles.message}>{this.props.t('error.boundary.message')}</ThemedText>

          {errorId && (
            <View style={styles.errorIdContainer}>
              <ThemedText style={styles.errorIdLabel}>
                {this.props.t('error.boundary.errorId')}:
              </ThemedText>
              <ThemedText style={styles.errorIdText}>{errorId}</ThemedText>
            </View>
          )}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.button, styles.retryButton]}
              onPress={this.handleRetry}
            >
              <Ionicons name="refresh" size={20} color="white" style={styles.buttonIcon} />
              <ThemedText style={styles.retryText}>
                {this.props.t('error.boundary.retry')}
                {retryCount > 0 && ` (${retryCount}/${maxRetries})`}
              </ThemedText>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.button, styles.reportButton]}
              onPress={this.handleReportIssue}
            >
              <Ionicons
                name="bug"
                size={20}
                color={colors.primaryColor}
                style={styles.buttonIcon}
              />
              <ThemedText style={styles.reportText}>
                {this.props.t('error.boundary.reportIssue')}
              </ThemedText>
            </TouchableOpacity>
          </View>

          {showErrorDetails && (
            <TouchableOpacity style={styles.detailsToggle} onPress={this.handleToggleDetails}>
              <ThemedText style={styles.detailsToggleText}>
                {showDetails
                  ? this.props.t('error.boundary.hideDetails')
                  : this.props.t('error.boundary.showDetails')}
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
                {this.props.t('error.boundary.technicalDetails')}
              </ThemedText>

              <View style={styles.errorSection}>
                <ThemedText style={styles.errorSectionTitle}>Error Message:</ThemedText>
                <ThemedText style={styles.errorText}>
                  {error?.message || 'Unknown error'}
                </ThemedText>
              </View>

              <View style={styles.errorSection}>
                <ThemedText style={styles.errorSectionTitle}>Error Type:</ThemedText>
                <ThemedText style={styles.errorText}>{error?.name || 'Unknown'}</ThemedText>
              </View>

              {error?.stack && (
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

    return this.props.children;
  }
}

// Wrap the component with translation HOC
const ErrorBoundary = withTranslation()(ErrorBoundaryBase);

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
