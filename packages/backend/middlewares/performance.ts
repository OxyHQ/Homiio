/**
 * Performance monitoring middleware
 * Tracks slow queries and provides performance insights
 */

import { Request, Response, NextFunction } from 'express';

const SLOW_QUERY_THRESHOLD = 100; // 100ms

function performanceMonitor(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();
  
  // Override res.json to capture response time
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - start;
    
    // Log slow queries
    if (duration > SLOW_QUERY_THRESHOLD) {
      console.warn(`🐌 Slow query detected: ${req.method} ${req.url} - ${duration}ms`);
    }
    
    // Add performance headers
    res.set('X-Response-Time', `${duration}ms`);
    
    return originalJson.call(this, data);
  };
  
  next();
}

export default performanceMonitor;