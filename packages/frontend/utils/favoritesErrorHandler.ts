export interface FavoritesError {
  code: string;
  message: string;
  userMessage: string;
  retryable: boolean;
  timestamp: Date;
}

export class FavoritesErrorHandler {
  private static readonly ERROR_CODES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    PERMISSION_ERROR: 'PERMISSION_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    SERVER_ERROR: 'SERVER_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR',
  } as const;

  static createError(error: any, context: string): FavoritesError {
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
    if (error?.status === 401 || error?.message?.includes('unauthorized')) {
      return {
        code: this.ERROR_CODES.AUTHENTICATION_ERROR,
        message: error.message || 'Authentication failed',
        userMessage: 'Please sign in to manage your favorites',
        retryable: false,
        timestamp,
      };
    }

    // Permission errors
    if (error?.status === 403 || error?.message?.includes('forbidden')) {
      return {
        code: this.ERROR_CODES.PERMISSION_ERROR,
        message: error.message || 'Permission denied',
        userMessage: 'You don\'t have permission to perform this action',
        retryable: false,
        timestamp,
      };
    }

    // Validation errors
    if (error?.status === 400 || error?.message?.includes('validation')) {
      return {
        code: this.ERROR_CODES.VALIDATION_ERROR,
        message: error.message || 'Invalid request',
        userMessage: 'Invalid property data. Please try again',
        retryable: false,
        timestamp,
      };
    }

    // Server errors
    if (error?.status >= 500 || error?.message?.includes('server')) {
      return {
        code: this.ERROR_CODES.SERVER_ERROR,
        message: error.message || 'Server error occurred',
        userMessage: 'Our servers are experiencing issues. Please try again later',
        retryable: true,
        timestamp,
      };
    }

    // Unknown errors
    return {
      code: this.ERROR_CODES.UNKNOWN_ERROR,
      message: error?.message || 'An unexpected error occurred',
      userMessage: 'Something went wrong. Please try again',
      retryable: true,
      timestamp,
    };
  }

  static isRetryableError(error: FavoritesError): boolean {
    return error.retryable;
  }

  static shouldShowUserMessage(error: FavoritesError): boolean {
    // Don't show user messages for validation errors (they're usually handled by the UI)
    return error.code !== this.ERROR_CODES.VALIDATION_ERROR;
  }

  static getRetryDelay(error: FavoritesError): number {
    switch (error.code) {
      case this.ERROR_CODES.NETWORK_ERROR:
        return 2000; // 2 seconds
      case this.ERROR_CODES.SERVER_ERROR:
        return 5000; // 5 seconds
      default:
        return 1000; // 1 second
    }
  }

  static logError(error: FavoritesError, context: string): void {
    console.error(`[Favorites Error] ${context}:`, {
      code: error.code,
      message: error.message,
      timestamp: error.timestamp,
      retryable: error.retryable,
    });
  }
} 