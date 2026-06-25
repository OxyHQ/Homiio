/**
 * Performance monitoring middleware
 * Tracks slow queries and provides performance insights
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from './logging';

const SLOW_QUERY_THRESHOLD = 100; // 100ms

function performanceMonitor(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  // Override res.json to capture response time
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - start;
    
    // Log slow queries
    if (duration > SLOW_QUERY_THRESHOLD) {
      logger.warn('Slow query detected', {
        method: req.method,
        url: req.url,
        durationMs: duration,
      });
    }
    
    // Add performance headers
    res.set('X-Response-Time', `${duration}ms`);
    
    return originalJson.call(this, data);
  };
  
  next();
}

export default performanceMonitor;