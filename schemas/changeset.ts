import { z } from 'zod';

/**
 * Changeset Schema
 * 
 * Tracks pending and applied changes when syncing between datasets.
 * 
 * Change statuses:
 * - pending: Not yet applied (waiting for auto-apply or manual approval)
 * - applied: Successfully applied to target dataset
 * - shadowed: Not applied because lower priority than existing data
 * - approved: Manually approved by user (ready for application)
 * - rejected: Manually rejected by user
 */

export const ChangeItemSchema = z.object({
  assetId: z.string().describe('ID of the asset being changed'),
  assetType: z.string().describe('Schema name (e.g., "AssetComputer")'),
  
  field: z.string().describe('JSONPath to field being changed (e.g., "osVersion")'),
  
  oldValue: z.any().nullable().describe('Current value in target dataset (null if new field)'),
  newValue: z.any().describe('Proposed new value from source'),
  
  mode: z.enum(['auto', 'review']).describe('Change mode from sync rule'),
  priority: z.number().describe('Priority from sync rule'),
  
  status: z.enum(['pending', 'applied', 'shadowed', 'approved', 'rejected']).describe('Change status'),
  
  reason: z.string().optional().describe('Explanation (e.g., why shadowed, why rejected)'),
  
  // Conflict information
  existingPriority: z.number().optional().describe('Priority of existing value (for shadowed changes)'),
  existingSource: z.string().optional().describe('Source of existing value (for shadowed changes)'),
  existingTimestamp: z.string().datetime().optional().describe('When existing value was last updated'),
  
  // Metadata
  detectedAt: z.string().datetime().describe('When change was detected'),
  appliedAt: z.string().datetime().optional().describe('When change was applied'),
  reviewedBy: z.string().optional().describe('User who reviewed (for manual changes)'),
  reviewedAt: z.string().datetime().optional().describe('When manually reviewed'),
});

export const ChangesetSchema = z.object({
  id: z.string().describe('Unique changeset identifier'),
  
  sourceDataset: z.string().describe('Source dataset ID (e.g., "ds-crowdstrike-endpoints")'),
  targetDataset: z.string().describe('Target dataset ID (e.g., "ds-consolidated-assets")'),
  ruleId: z.string().describe('ID of sync rule that generated this changeset'),
  ruleName: z.string().describe('Name of sync rule'),
  
  status: z.enum(['pending', 'applied', 'partial', 'rejected']).describe('Overall changeset status'),
  
  changes: z.array(ChangeItemSchema).describe('Individual field changes'),
  
  // Summary statistics
  summary: z.object({
    total: z.number().describe('Total changes'),
    auto: z.number().describe('Auto-apply changes'),
    review: z.number().describe('Manual review changes'),
    applied: z.number().describe('Successfully applied'),
    shadowed: z.number().describe('Shadowed by higher priority'),
    pending: z.number().describe('Still pending'),
    approved: z.number().describe('Manually approved'),
    rejected: z.number().describe('Manually rejected'),
  }),
  
  // Metadata
  createdAt: z.string().datetime().describe('Changeset creation timestamp'),
  appliedAt: z.string().datetime().optional().describe('When auto-changes were applied'),
  completedAt: z.string().datetime().optional().describe('When all changes finalized'),
  
  sourceSnapshotId: z.string().optional().describe('ID of source snapshot that triggered this changeset'),
});

export const ChangesetSchemaV1 = ChangesetSchema;

export type Changeset = z.infer<typeof ChangesetSchema>;
export type ChangeItem = z.infer<typeof ChangeItemSchema>;

/**
 * Example changeset:
 * 
 * {
 *   id: "changeset-001",
 *   sourceDataset: "ds-crowdstrike-endpoints",
 *   targetDataset: "ds-consolidated-assets",
 *   ruleId: "rule-001",
 *   ruleName: "CrowdStrike to Consolidated Assets - High Priority",
 *   status: "partial",
 *   changes: [
 *     {
 *       assetId: "srv-001",
 *       assetType: "AssetComputer",
 *       field: "agentVersion",
 *       oldValue: "7.10.0",
 *       newValue: "7.10.17605.0",
 *       mode: "auto",
 *       priority: 90,
 *       status: "applied",
 *       detectedAt: "2026-02-27T10:00:00Z",
 *       appliedAt: "2026-02-27T10:00:01Z"
 *     },
 *     {
 *       assetId: "srv-001",
 *       assetType: "AssetComputer",
 *       field: "osVersion",
 *       oldValue: "Ubuntu 22.04",
 *       newValue: "Ubuntu 20.04",
 *       mode: "auto",
 *       priority: 70,
 *       status: "shadowed",
 *       reason: "Existing value has higher priority (80 from azure-vms)",
 *       existingPriority: 80,
 *       existingSource: "azure-vms",
 *       existingTimestamp: "2026-02-27T09:00:00Z",
 *       detectedAt: "2026-02-27T10:00:00Z"
 *     },
 *     {
 *       assetId: "srv-001",
 *       assetType: "AssetComputer",
 *       field: "manufacturer",
 *       oldValue: null,
 *       newValue: "Dell Inc.",
 *       mode: "review",
 *       priority: 50,
 *       status: "pending",
 *       detectedAt: "2026-02-27T10:00:00Z"
 *     }
 *   ],
 *   summary: {
 *     total: 3,
 *     auto: 2,
 *     review: 1,
 *     applied: 1,
 *     shadowed: 1,
 *     pending: 1,
 *     approved: 0,
 *     rejected: 0
 *   },
 *   createdAt: "2026-02-27T10:00:00Z",
 *   appliedAt: "2026-02-27T10:00:01Z"
 * }
 */
