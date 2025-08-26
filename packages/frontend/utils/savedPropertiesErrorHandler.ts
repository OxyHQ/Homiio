export interface SavedPropertiesError {
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  timestamp: Date;
}

export class SavedPropertiesErrorHandler {
  private static readonly ERROR_CODES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SERVER_ERROR: 'SERVER_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  } as const;

  static createError(error: any, context: string): SavedPropertiesError {
    const timestamp = new Date();

    // Network errors
    if (error?.code === 'NETWORK_ERROR' || error?.message?.includes('network')) {
      return {
        code: this.ERROR_CODES.NETWORK_ERROR,
        message: error.message || 'Network error occurred',
        userMessage: 'Please check your internet connection and try again',
        retryable: true,
        timestamp,
      };
    }

    // Authentication errors
    if (error?.code === 'AUTHENTICATION_ERROR' || error?.status === 401) {
      return {
        code: this.ERROR_CODES.AUTHENTICATION_ERROR,
        message: error.message || 'Authentication failed',
        userMessage: 'Please sign in to manage saved properties',
        retryable: false,
        timestamp,
      };
    }

    // Permission errors
    if (error?.code === 'PERMISSION_ERROR' || error?.status === 403) {
      return {
        code: this.ERROR_CODES.PERMISSION_ERROR,
        message: error.message || 'Permission denied',
        userMessage: 'You do not have permission to perform this action',
        retryable: false,
        timestamp,
      };
    }

    // Validation errors
    if (error?.code === 'VALIDATION_ERROR' || error?.status === 400) {
      return {
        code: this.ERROR_CODES.VALIDATION_ERROR,
        message: error.message || 'Validation failed',
        userMessage: error.message || 'Invalid data provided',
        retryable: false,
        timestamp,
      };
    }

    // Server errors
    if (error?.status >= 500 || error?.code === 'SERVER_ERROR') {
      return {
        code: this.ERROR_CODES.SERVER_ERROR,
        message: error.message || 'Server error occurred',
        userMessage: 'Something went wrong on our end. Please try again later',
        retryable: true,
        timestamp,
      };
    }

    // Unknown errors
    return {
      code: this.ERROR_CODES.UNKNOWN_ERROR,
      message: error?.message || 'An unknown error occurred',
      userMessage: 'Something went wrong. Please try again',
      retryable: true,
      timestamp,
    };
  }

  static logError(error: SavedPropertiesError, context: string): void {
    console.error(`[SavedProperties] Error in ${context}:`, {
      code: error.code,
      message: error.message,
      userMessage: error.userMessage,
      retryable: error.retryable,
      timestamp: error.timestamp,
      context,
    });
  }

  static shouldShowUserMessage(error: SavedPropertiesError): boolean {
    // Don't show user messages for certain error types that should be handled silently
    return error.code !== this.ERROR_CODES.AUTHENTICATION_ERROR;
  }

  static isRetryable(error: SavedPropertiesError): boolean {
    return error.retryable;
  }

  static getRetryDelay(attemptNumber: number): number {
    // Exponential backoff with jitter
    const baseDelay = 1000; // 1 second
    const maxDelay = 10000; // 10 seconds
    const delay = Math.min(baseDelay * Math.pow(2, attemptNumber), maxDelay);
    const jitter = Math.random() * 0.1 * delay; // Add up to 10% jitter
    return delay + jitter;
  }
}