import { z } from 'zod';
import { BaseAssetSchema } from '../base/asset.js';

/**
 * AssetComputer - Schema for computing assets (servers, VMs, workstations)
 * 
 * Extends BaseAsset with fields specific to computing infrastructure.
 */
export const AssetComputerSchema = BaseAssetSchema.extend({
  // Override type to be specific
  type: z.literal('computer'),
  
  // Operating system information
  os: z.string().optional(),
  osVersion: z.string().optional(),
  
  // Hardware specifications
  cpu: z.number().int().positive().optional(), // CPU cores
  memory: z.number().int().positive().optional(), // Memory in MB
  storage: z.number().int().positive().optional(), // Storage in GB
  
  // Network interfaces
  network: z.array(z.object({
    interface: z.string(),
    ipAddress: z.string().optional(),
    macAddress: z.string().optional(),
    type: z.enum(['physical', 'virtual', 'loopback']).optional(),
  })).optional().default([]),
  
  // Status
  status: z.enum(['running', 'stopped', 'unknown', 'maintenance']).optional(),
  
  // Hostname/FQDN
  hostname: z.string().optional(),
  fqdn: z.string().optional(),
  
  // Virtualization
  virtualization: z.object({
    type: z.enum(['vm', 'container', 'physical']).optional(),
    hypervisor: z.string().optional(),
    hostId: z.string().optional(),
  }).optional(),
  
  // Vendor-specific and additional data
  extendedData: z.record(z.string(), z.any()).optional().default({}),
});

export type AssetComputer = z.infer<typeof AssetComputerSchema>;

// Version 1 of the schema (for versioning system)
export const AssetComputerSchemaV1 = AssetComputerSchema;
