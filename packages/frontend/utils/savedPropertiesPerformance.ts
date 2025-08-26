export interface SavedPropertiesMetrics {
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

export class SavedPropertiesPerformance {
  private static metrics: SavedPropertiesMetrics[] = [];
  private static config: PerformanceConfig = {
    enabled: __DEV__, // Only enable in development by default
    logThreshold: 1000,
    sampleRate: 0.1, // Track 10% of operations
  };

  static configure(config: Partial<PerformanceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  static startTimer(
    operation: string,
    propertyId: string,
  ): (success: boolean, error?: string) => void {
    if (!this.config.enabled || Math.random() > this.config.sampleRate) {
      return () => {}; // Return no-op function
    }

    const startTime = performance.now();
    const timestamp = new Date();

    return (success: boolean, error?: string) => {
      const duration = performance.now() - startTime;

      const metric: SavedPropertiesMetrics = {
        operation,
        propertyId,
        duration,
        success,
        timestamp,
        error,
      };

      this.recordMetric(metric);
    };
  }

  private static recordMetric(metric: SavedPropertiesMetrics): void {
    this.metrics.push(metric);

    // Log slow operations
    if (metric.duration > this.config.logThreshold) {
      console.warn(`[SavedProperties] Slow operation detected:`, {
        operation: metric.operation,
        propertyId: metric.propertyId,
        duration: `${metric.duration.toFixed(2)}ms`,
        success: metric.success,
        error: metric.error,
      });
    }

    // Keep only the last 100 metrics to prevent memory leaks
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }
  }

  static getMetrics(): SavedPropertiesMetrics[] {
    return [...this.metrics];
  }

  static getAverageOperationTime(operation: string): number {
    const operationMetrics = this.metrics.filter((m) => m.operation === operation);
    if (operationMetrics.length === 0) return 0;

    const totalTime = operationMetrics.reduce((sum, metric) => sum + metric.duration, 0);
    return totalTime / operationMetrics.length;
  }

  static getSuccessRate(operation: string): number {
    const operationMetrics = this.metrics.filter((m) => m.operation === operation);
    if (operationMetrics.length === 0) return 0;

    const successfulOperations = operationMetrics.filter((m) => m.success).length;
    return successfulOperations / operationMetrics.length;
  }

  static clearMetrics(): void {
    this.metrics = [];
  }

  static generateReport(): string {
    const operationSet = new Set(this.metrics.map((m) => m.operation));
    const operations = Array.from(operationSet);
    const report = operations.map((operation) => {
      const avgTime = this.getAverageOperationTime(operation);
      const successRate = this.getSuccessRate(operation);
      const count = this.metrics.filter((m) => m.operation === operation).length;

      return `${operation}: ${count} ops, ${avgTime.toFixed(2)}ms avg, ${(successRate * 100).toFixed(1)}% success`;
    });

    return `SavedProperties Performance Report:\n${report.join('\n')}`;
  }
}