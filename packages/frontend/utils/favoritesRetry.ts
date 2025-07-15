import { FavoritesErrorHandler, FavoritesError } from './favoritesErrorHandler';

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export interface RetryResult<T> {
  success: boolean;
  data?: T;
  error?: FavoritesError;
  attempts: number;
}

export class FavoritesRetry {
  private static readonly DEFAULT_CONFIG: RetryConfig = {
    maxAttempts: 3,
    baseDelay: 1000,
    maxDelay: 10000,
    backoffMultiplier: 2,
  };

  static async execute<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {}
  ): Promise<RetryResult<T>> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let lastError: FavoritesError;
    let delay = finalConfig.baseDelay;

    for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
      try {
        const result = await operation();
        return {
          success: true,
          data: result,
          attempts: attempt,
        };
      } catch (error: any) {
        lastError = FavoritesErrorHandler.createError(error, `Attempt ${attempt}`);
        
        // Log the error
        FavoritesErrorHandler.logError(lastError, `Retry attempt ${attempt}`);

        // Don't retry if it's not a retryable error
        if (!FavoritesErrorHandler.isRetryableError(lastError)) {
          return {
            success: false,
            error: lastError,
            attempts: attempt,
          };
        }

        // Don't retry if we've reached max attempts
        if (attempt >= finalConfig.maxAttempts) {
          return {
            success: false,
            error: lastError,
            attempts: attempt,
          };
        }

        // Wait before next attempt
        await this.delay(delay);
        
        // Calculate next delay with exponential backoff
        delay = Math.min(
          delay * finalConfig.backoffMultiplier,
          finalConfig.maxDelay
        );
      }
    }

    return {
      success: false,
      error: lastError!,
      attempts: finalConfig.maxAttempts,
    };
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  static shouldRetry(error: FavoritesError): boolean {
    return FavoritesErrorHandler.isRetryableError(error);
  }

  static getRetryDelay(error: FavoritesError, attempt: number): number {
    const baseDelay = FavoritesErrorHandler.getRetryDelay(error);
    return Math.min(baseDelay * Math.pow(2, attempt - 1), 10000);
  }
} 