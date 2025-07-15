export interface FavoritesMetrics {
  operation: string;
  propertyId: string;
  duration: number;
  success: boolean;
  timestamp: Date;
  error?: string;
}

export interface PerformanceConfig {
  enabled: boolean;
  logThreshold: number; // Log operations slower than this (ms)
  sampleRate: number; // Percentage of operations to track (0-1)
}

export class FavoritesPerformance {
  private static metrics: FavoritesMetrics[] = [];
  private static config: PerformanceConfig = {
    enabled: __DEV__, // Only enable in development by default
    logThreshold: 1000,
    sampleRate: 0.1, // Track 10% of operations
  };

  static configure(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  static startTimer(operation: string, propertyId: string): (success?: boolean, error?: string) => void {
    if (!this.config.enabled || Math.random() > this.config.sampleRate) {
      return () => {}; // No-op timer
    }

    const startTime = performance.now();
    const timestamp = new Date();

    return (success: boolean = true, error?: string) => {
      const duration = performance.now() - startTime;
      
      const metric: FavoritesMetrics = {
        operation,
        propertyId,
        duration,
        success,
        timestamp,
        error,
      };

      this.metrics.push(metric);

      // Log slow operations
      if (duration > this.config.logThreshold) {
        console.warn(`[Favorites Performance] Slow operation detected:`, {
          operation,
          propertyId,
          duration: `${duration.toFixed(2)}ms`,
          threshold: `${this.config.logThreshold}ms`,
        });
      }

      // Log errors
      if (!success) {
        console.error(`[Favorites Performance] Operation failed:`, {
          operation,
          propertyId,
          duration: `${duration.toFixed(2)}ms`,
          error,
        });
      }
    };
  }

  static getMetrics(): FavoritesMetrics[] {
    return [...this.metrics];
  }

  static getMetricsByOperation(operation: string): FavoritesMetrics[] {
    return this.metrics.filter(m => m.operation === operation);
  }

  static getAverageDuration(operation?: string): number {
    const relevantMetrics = operation 
      ? this.getMetricsByOperation(operation)
      : this.metrics;

    if (relevantMetrics.length === 0) return 0;

    const totalDuration = relevantMetrics.reduce((sum, m) => sum + m.duration, 0);
    return totalDuration / relevantMetrics.length;
  }

  static getSuccessRate(operation?: string): number {
    const relevantMetrics = operation 
      ? this.getMetricsByOperation(operation)
      : this.metrics;

    if (relevantMetrics.length === 0) return 1;

    const successfulOperations = relevantMetrics.filter(m => m.success).length;
    return successfulOperations / relevantMetrics.length;
  }

  static clearMetrics(): void {
    this.metrics = [];
  }

  static getMetricsSummary(): {
    totalOperations: number;
    averageDuration: number;
    successRate: number;
    slowOperations: number;
    failedOperations: number;
  } {
    const totalOperations = this.metrics.length;
    const averageDuration = this.getAverageDuration();
    const successRate = this.getSuccessRate();
    const slowOperations = this.metrics.filter(m => m.duration > this.config.logThreshold).length;
    const failedOperations = this.metrics.filter(m => !m.success).length;

    return {
      totalOperations,
      averageDuration,
      successRate,
      slowOperations,
      failedOperations,
    };
  }

  static logSummary(): void {
    if (!this.config.enabled) return;

    const summary = this.getMetricsSummary();
    console.log('[Favorites Performance] Summary:', summary);
  }
} 