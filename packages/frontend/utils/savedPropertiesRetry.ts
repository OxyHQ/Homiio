import { SavedPropertiesErrorHandler, SavedPropertiesError } from './savedPropertiesErrorHandler';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: SavedPropertiesError;
  attempts: number;
}

export class SavedPropertiesRetry {
  private static readonly DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  static async execute<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
  ): Promise<RetryResult<T>> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let lastError: SavedPropertiesError;

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          attempts: attempt,
        };
      } catch (error: any) {
        lastError = SavedPropertiesErrorHandler.createError(error, 'retry-operation');

        // Don't retry if the error is not retryable
        if (!SavedPropertiesErrorHandler.isRetryable(lastError)) {
          return {
            success: false,
            error: lastError,
            attempts: attempt,
          };
        }

        // Don't wait after the last attempt
        if (attempt < finalConfig.maxAttempts) {
          const delay = Math.min(
            finalConfig.baseDelay * Math.pow(finalConfig.backoffMultiplier, attempt - 1),
            finalConfig.maxDelay,
          );
          await this.delay(delay);
        }
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts: finalConfig.maxAttempts,
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static isRetryableError(error: any): boolean {
    const savedPropertiesError = SavedPropertiesErrorHandler.createError(error, 'check-retryable');
    return SavedPropertiesErrorHandler.isRetryable(savedPropertiesError);
  }
}