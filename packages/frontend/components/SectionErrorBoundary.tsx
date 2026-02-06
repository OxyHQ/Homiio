import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from './ThemedText';
import { colors } from '@/styles/colors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  sectionName?: string;
}

interface State {
  hasError: boolean;
}

/**
 * Lightweight error boundary for individual page sections.
 * Unlike the full ErrorBoundary, this shows a simple retry UI inline
 * so one failing section doesn't crash the entire page.
 */
export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // In production, send to error reporting service (PostHog, Sentry, etc.)
    if (__DEV__) {
      console.error(`SectionErrorBoundary [${this.props.sectionName || 'unknown'}]:`, error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <View style={styles.container}>
          <ThemedText style={styles.text}>
            {this.props.sectionName
              ? `Failed to load ${this.props.sectionName}`
              : 'Something went wrong'}
          </ThemedText>
          <TouchableOpacity style={styles.retryButton} onPress={this.handleRetry}>
            <ThemedText style={styles.retryText}>Retry</ThemedText>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 80,
  },
  text: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 8,
    textAlign: 'center',
  },
  retryButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  retryText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
  },
});
