import { z } from 'zod';
import { BaseAssetSchema } from '../base/asset.js';

/**
 * AssetNetwork - Schema for network infrastructure (switches, routers, firewalls)
 * 
 * Extends BaseAsset with fields specific to network devices and infrastructure.
 */
export const AssetNetworkSchema = BaseAssetSchema.extend({
  // Override type to be specific
  type: z.literal('network'),
  
  // Network addressing
  ipAddress: z.string().optional(),
  subnet: z.string().optional(), // CIDR notation
  vlan: z.number().int().optional(),
  
  // Device type
  deviceType: z.enum([
    'switch',
    'router',
    'firewall',
    'load-balancer',
    'gateway',
    'access-point',
    'other'
  ]).optional(),
  
  // Vendor information
  vendor: z.string().optional(),
  model: z.string().optional(),
  firmware: z.string().optional(),
  
  // Capacity/specifications
  ports: z.number().int().positive().optional(),
  bandwidth: z.string().optional(), // e.g., "10Gbps"
  
  // Status
  status: z.enum(['active', 'inactive', 'maintenance', 'unknown']).optional(),
  
  // Management
  managementIp: z.string().optional(),
  
  // Connected devices/interfaces
  connections: z.array(z.object({
    port: z.string().optional(),
    connectedTo: z.string().optional(), // Asset ID or identifier
    description: z.string().optional(),
  })).optional().default([]),
  
  // Vendor-specific and additional data
  extendedData: z.record(z.string(), z.any()).optional().default({}),
});

export type AssetNetwork = z.infer<typeof AssetNetworkSchema>;

// Version 1 of the schema
export const AssetNetworkSchemaV1 = AssetNetworkSchema;
