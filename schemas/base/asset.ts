import { z } from 'zod';

/**
 * BaseAsset - Core schema for all asset types
 * 
 * Common fields across IT infrastructure, cloud resources, and security assets.
 * Specific asset types extend this base with additional fields.
 */
export const BaseAssetSchema = z.object({
  // Unique identifier (from source system or generated)
  id: z.string().min(1),
  
  // Human-readable name
  name: z.string().min(1),
  
  // Asset type discriminator (computer, network, control-device, etc.)
  type: z.string().min(1),
  
  // When this asset was discovered/last seen
  discoveredAt: z.string().datetime(),
  
  // Source identifier (e.g., 'aws-ec2', 'agent-cmdb', 'crowdstrike')
  source: z.string().min(1),
  
  // Schema version for this asset
  schemaVersion: z.number().int().positive(),
  
  // Optional description
  description: z.string().optional(),
  
  // Optional tags for categorization
  tags: z.array(z.string()).optional().default([]),
  
  // Optional location information
  location: z.object({
    datacenter: z.string().optional(),
    region: z.string().optional(),
    zone: z.string().optional(),
    building: z.string().optional(),
    room: z.string().optional(),
  }).optional(),
  
  // Optional ownership/responsibility
  ownership: z.object({
    owner: z.string().optional(),
    team: z.string().optional(),
    contact: z.string().optional(),
  }).optional(),
});

export type BaseAsset = z.infer<typeof BaseAssetSchema>;
