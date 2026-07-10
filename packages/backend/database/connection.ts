/**
 * Database Connection Module
 * Handles MongoDB connection using Mongoose
 */

import mongoose from 'mongoose';
import config from '../config';
import { getErrorMessage } from '../utils/errors';
import { logger } from '../middlewares/logging';
import { ensureCityGeoIndexes } from '../services/cityGeoMigration';

class Database {
  private connection: any;
  private isConnected: boolean;
  private listenerRegistered: boolean;

  constructor() {
    this.connection = null;
    this.isConnected = false;
    this.listenerRegistered = false;
  }

  /**
   * Connect to MongoDB database
   */
  async connect() {
    try {
      // Check if already connected and connection is healthy
      if (this.isConnected && mongoose.connection.readyState === 1) {
        return this.connection;
      }

      // If connection exists but is not healthy, close it first
      if (mongoose.connection.readyState !== 0) {
        await mongoose.connection.close();
        this.isConnected = false;
      }

      // Set mongoose options
      mongoose.set('strictQuery', false);

      // Connect to MongoDB with retry logic for serverless environments
      const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
      const maxRetries = isServerless ? 3 : 1;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          this.connection = await mongoose.connect(config.database.url, config.database.options);
          break;
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            const delay = attempt * 1000;
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!this.connection) {
        throw lastError || new Error('Database connection failed after all retries');
      }

      this.isConnected = true;

      // Retire legacy City `(name, state, country)` indexes before ingest/geo
      // upserts run — idempotent, fast once production is clean.
      await ensureCityGeoIndexes();

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        logger.error('Database connection error', { message: error.message });
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        this.isConnected = true;
      });

      // Handle process termination — register only once to prevent memory leak
      if (!this.listenerRegistered) {
        this.listenerRegistered = true;
        process.on('SIGINT', async () => {
          await this.disconnect();
          process.exit(0);
        });
        process.on('SIGTERM', async () => {
          await this.disconnect();
          process.exit(0);
        });
      }

      return this.connection;
    } catch (error) {
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    try {
      if (!this.isConnected) return;
      await mongoose.connection.close();
      this.isConnected = false;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      port: mongoose.connection.port,
      name: mongoose.connection.name
    };
  }

  /**
   * Check if database is connected
   */
  get isConnectedStatus(): boolean {
    return this.isConnected;
  }

  /**
   * Force reconnect to database
   */
  async forceReconnect() {
    try {
      this.isConnected = false;
      await mongoose.connection.close();
      return await this.connect();
    } catch (error) {
      throw error;
    }
  }

  /**
   * Health check for database
   */
  async healthCheck() {
    try {
      if (!this.isConnected) {
        return {
          status: 'disconnected',
          message: 'Database is not connected'
        };
      }

      const database = mongoose.connection.db;
      if (!database) {
        return {
          status: 'disconnected',
          message: 'Database handle is not available'
        };
      }

      // Try to ping the database
      await database.admin().ping();

      return {
        status: 'healthy',
        message: 'Database is responding',
        details: this.getStatus()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'Database health check failed',
        error: getErrorMessage(error)
      };
    }
  }
}

// Create singleton instance
const database = new Database();

export default database;
