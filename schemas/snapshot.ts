import { z } from 'zod';

/**
 * Snapshot Schema
 * 
 * Standard structure for all snapshot documents stored in MongoDB.
 * Snapshots represent a point-in-time collection of data from a connector.
 */

export const SnapshotErrorSchema = z.object({
  index: z.number().describe('Index of the item that failed validation'),
  error: z.string().describe('Error message'),
});

export const SnapshotMetadataSchema = z.object({
  totalItems: z.number().describe('Total number of items collected'),
  validItems: z.number().describe('Number of items that passed validation'),
  invalidItems: z.number().describe('Number of items that failed validation'),
  collectionDuration: z.number().optional().describe('Collection duration in milliseconds'),
  errors: z.array(SnapshotErrorSchema).optional().describe('Validation errors for invalid items'),
});

export const SnapshotSchema = z.object({
  snapshotTime: z.date().describe('Time when the snapshot was taken'),
  schemaName: z.string().describe('Schema name (e.g., "AssetComputer", "AssetNetwork")'),
  schemaVersion: z.number().describe('Schema version number'),
  source: z.string().describe('Source identifier (e.g., "aws-ec2", "azure-vms", "crowdstrike")'),
  data: z.array(z.any()).describe('Array of validated items'),
  metadata: SnapshotMetadataSchema,
});

export const SnapshotSchemaV1 = SnapshotSchema;

export type Snapshot = z.infer<typeof SnapshotSchema>;
export type SnapshotMetadata = z.infer<typeof SnapshotMetadataSchema>;
export type SnapshotError = z.infer<typeof SnapshotErrorSchema>;

/**
 * Example snapshot:
 * 
 * {
 *   snapshotTime: new Date("2026-02-27T10:00:00Z"),
 *   schemaName: "AssetComputer",
 *   schemaVersion: 1,
 *   source: "azure-vms",
 *   data: [
 *     { id: "vm-001", name: "web-server-01", ... },
 *     { id: "vm-002", name: "db-server-01", ... }
 *   ],
 *   metadata: {
 *     totalItems: 100,
 *     validItems: 98,
 *     invalidItems: 2,
 *     collectionDuration: 5432,
 *     errors: [
 *       { index: 42, error: "Missing required field: id" },
 *       { index: 57, error: "Invalid memory value: must be positive" }
 *     ]
 *   }
 * }
 */
