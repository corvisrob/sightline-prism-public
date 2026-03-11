import { z } from 'zod';

/**
 * Sync Rule Schema
 * 
 * Defines how to sync/merge data between datasets.
 * 
 * Source can be:
 * - connected dataset (from a connector like Azure, CrowdStrike)
 * - synthetic dataset (previously merged data)
 * 
 * Target can be:
 * - synthetic dataset (consolidated/merged data)
 * 
 * Field rules specify:
 * - Which fields to sync
 * - Whether they require manual review or auto-apply
 * - Priority for conflict resolution
 */

export const FieldRuleSchema = z.object({
  sourceField: z.string().describe('JSONPath to field in source data (e.g., "extendedData.azureVmSize")'),
  targetField: z.string().describe('JSONPath to field in target dataset (e.g., "vmSize")'),
  mode: z.enum(['auto', 'review']).describe('auto: automatically apply, review: requires manual approval'),
  priority: z.number().min(0).max(100).describe('Priority (0-100). Higher priority wins conflicts.'),
  transform: z.string().optional().describe('Optional transform function name (e.g., "uppercase", "parseDate")'),
  condition: z.string().optional().describe('Optional condition to evaluate before syncing (e.g., "status === active")'),
});

export const SyncRuleSchema = z.object({
  id: z.string().describe('Unique rule identifier'),
  name: z.string().describe('Human-readable rule name'),
  description: z.string().optional().describe('Rule description'),
  
  sourceDataset: z.string().describe('Source dataset ID (e.g., "ds-crowdstrike-endpoints", "ds-azure-vms-prod")'),
  targetDataset: z.string().describe('Target dataset ID (e.g., "ds-consolidated-assets")'),
  targetSchema: z.string().describe('Target schema name (e.g., "AssetComputer", "AssetNetwork")'),
  
  enabled: z.boolean().default(true).describe('Whether this rule is active'),
  
  fieldRules: z.array(FieldRuleSchema).describe('Field-level sync rules'),
  
  // Matching criteria
  matchOn: z.array(z.object({
    sourceField: z.string().describe('Field name in source dataset'),
    targetField: z.string().describe('Field name in target dataset'),
  })).describe('Fields to match assets between source and target (e.g., [{ sourceField: "id", targetField: "id" }])'),
  
  // Metadata
  createdAt: z.string().datetime().describe('Rule creation timestamp'),
  updatedAt: z.string().datetime().describe('Rule last update timestamp'),
  version: z.number().default(1).describe('Rule version for change tracking'),
});

export const SyncRuleSchemaV1 = SyncRuleSchema;

export type SyncRule = z.infer<typeof SyncRuleSchema>;
export type FieldRule = z.infer<typeof FieldRuleSchema>;
export type MatchRule = z.infer<typeof SyncRuleSchema>['matchOn'][number];

/**
 * Example sync rule:
 * 
 * {
 *   id: "rule-001",
 *   name: "CrowdStrike to Consolidated Assets - High Priority",
 *   sourceDataset: "ds-crowdstrike-endpoints",
 *   targetDataset: "ds-consolidated-assets",
 *   targetSchema: "AssetComputer",
 *   enabled: true,
 *   matchOn: ["id", "hostname"],
 *   fieldRules: [
 *     {
 *       sourceField: "agent_version",
 *       targetField: "agentVersion",
 *       mode: "auto",
 *       priority: 90  // High priority - CrowdStrike is authoritative for agent info
 *     },
 *     {
 *       sourceField: "os_version",
 *       targetField: "osVersion",
 *       mode: "auto",
 *       priority: 70  // Medium priority - other sources might be more accurate
 *     },
 *     {
 *       sourceField: "system_manufacturer",
 *       targetField: "manufacturer",
 *       mode: "review",  // Manual review required
 *       priority: 50
 *     }
 *   ]
 * }
 */
