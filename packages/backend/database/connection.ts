/**
 * Database Connection Module
 * Handles MongoDB connection using Mongoose
 */

import mongoose from 'mongoose';
import config from '../config';

class Database {
  private connection: any;
  private isConnected: boolean;

  constructor() {
    this.connection = null;
    this.isConnected = false;
  }

  /**
   * Connect to MongoDB database
   */
  async connect() {
    try {
      if (this.isConnected) {
        console.log('📦 Database already connected');
        return this.connection;
      }

      console.log('📦 Connecting to database...');
      console.log(`📦 Database URL: ${config.database.url}`);

      // Set mongoose options
      mongoose.set('strictQuery', false);

      // Connect to MongoDB with retry logic for serverless environments
      const isServerless = process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME;
      const maxRetries = isServerless ? 3 : 1;
      let lastError;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          console.log(`📦 Database connection attempt ${attempt}/${maxRetries}`);
          this.connection = await mongoose.connect(config.database.url, config.database.options);
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error;
          console.error(`❌ Database connection attempt ${attempt} failed:`, error.message);
          
          if (attempt < maxRetries) {
            const delay = attempt * 1000; // Exponential backoff
            console.log(`📦 Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      if (!this.connection) {
        throw lastError || new Error('Database connection failed after all retries');
      }

      this.isConnected = true;

      console.log('✅ Database connected successfully');
      console.log(`📦 Database: ${this.connection.connection.name}`);
      console.log(`📦 Host: ${this.connection.connection.host}:${this.connection.connection.port}`);

      // Handle connection events
      mongoose.connection.on('error', (error) => {
        console.error('❌ Database connection error:', error);
        this.isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        console.log('⚠️  Database disconnected');
        this.isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        console.log('🔄 Database reconnected');
        this.isConnected = true;
      });

      // Handle process termination
      process.on('SIGINT', async () => {
        await this.disconnect();
        process.exit(0);
      });

      return this.connection;
    } catch (error) {
      console.error('❌ Database connection failed:', error.message);
      this.isConnected = false;
      throw error;
    }
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    try {
      if (!this.isConnected) {
        console.log('📦 Database already disconnected');
        return;
      }

      await mongoose.connection.close();
      this.isConnected = false;
      console.log('📦 Database disconnected gracefully');
    } catch (error) {
      console.error('❌ Error disconnecting from database:', error.message);
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

      // Try to ping the database
      await mongoose.connection.db.admin().ping();

      return {
        status: 'healthy',
        message: 'Database is responding',
        details: this.getStatus()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        message: 'Database health check failed',
        error: error.message
      };
    }
  }
}

// Create singleton instance
const database = new Database();

export default database;
