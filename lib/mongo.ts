import { MongoClient, Db, Collection, Document } from 'mongodb';
import * as dotenv from 'dotenv';
import { createLogger } from './logger.js';
import type { Logger } from './logger.js';

// Load environment variables
dotenv.config();

/**
 * MongoDB Connection Manager
 * 
 * Provides connection pooling and collection access for Prism.
 */
class PrismMongoDB {
  private client: MongoClient | null = null;
  private db: Db | null = null;

  private readonly uri: string;
  private readonly dbName: string;
  private readonly logger: Logger;

  constructor(logger?: Logger) {
    this.uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    this.dbName = process.env.MONGODB_DB || 'prism';
    this.logger = logger ?? createLogger('mongodb');
  }
  
  /**
   * Connect to MongoDB
   */
  async connect(): Promise<void> {
    if (this.client) {
      return; // Already connected
    }
    
    try {
      this.client = new MongoClient(this.uri);
      await this.client.connect();
      this.db = this.client.db(this.dbName);
      this.logger.info(`✅ Connected to MongoDB: ${this.dbName}`);
    } catch (error) {
      this.logger.error(`❌ MongoDB connection failed: ${error}`);
      throw error;
    }
  }
  
  /**
   * Disconnect from MongoDB
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.db = null;
      this.logger.info('Disconnected from MongoDB');
    }
  }
  
  /**
   * Get the database instance
   */
  getDb(): Db {
    if (!this.db) {
      throw new Error('Not connected to MongoDB. Call connect() first.');
    }
    return this.db;
  }
  
  /**
   * Get a collection for a specific source
   * 
   * @param sourceName - Source identifier (e.g., 'aws-ec2', 'agent-cmdb')
   * @returns MongoDB collection for storing snapshots from this source
   */
  getCollectionForSource<T extends Document = Document>(sourceName: string): Collection<T> {
    const db = this.getDb();
    const collectionName = `snapshots_${sourceName}`;
    return db.collection<T>(collectionName);
  }
  
  /**
   * Get a collection by name
   */
  getCollection<T extends Document = Document>(collectionName: string): Collection<T> {
    const db = this.getDb();
    return db.collection<T>(collectionName);
  }
  
  /**
   * Insert a snapshot document
   * 
   * @param collection - Target collection
   * @param snapshot - Snapshot document to insert
   * @returns Inserted document ID
   */
  async insertSnapshot<T extends Document>(
    collection: Collection<T>,
    snapshot: T
  ): Promise<string> {
    try {
      const result = await collection.insertOne(snapshot as any);
      return result.insertedId.toString();
    } catch (error) {
      this.logger.error(`❌ Failed to insert snapshot: ${error}`);
      throw error;
    }
  }
  
  /**
   * Get the latest snapshot from a source
   */
  async getLatestSnapshot<T extends Document>(sourceName: string): Promise<T | null> {
    const collection = this.getCollectionForSource<T>(sourceName);
    const snapshot = await collection
      .find()
      .sort({ snapshotTime: -1 })
      .limit(1)
      .toArray();
    
    return snapshot.length > 0 ? snapshot[0] as T : null;
  }
  
  /**
   * Get all snapshots from a source within a time range
   */
  async getSnapshotsInRange<T extends Document>(
    sourceName: string,
    startTime: Date,
    endTime: Date
  ): Promise<T[]> {
    const collection = this.getCollectionForSource<T>(sourceName);
    return collection
      .find({
        snapshotTime: { $gte: startTime, $lte: endTime },
      } as any)
      .sort({ snapshotTime: -1 })
      .toArray() as Promise<T[]>;
  }
  
  /**
   * Count total snapshots from a source
   */
  async countSnapshots(sourceName: string): Promise<number> {
    const collection = this.getCollectionForSource(sourceName);
    return collection.countDocuments();
  }
}

// Singleton instance
const mongoInstance = new PrismMongoDB();

export default mongoInstance;
export { PrismMongoDB };
