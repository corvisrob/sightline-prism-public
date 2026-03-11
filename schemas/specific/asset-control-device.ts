import { z } from 'zod';
import { BaseAssetSchema } from '../base/asset.js';

/**
 * AssetControlDevice - Schema for control systems and OT devices
 * 
 * Extends BaseAsset with fields specific to industrial control devices,
 * SCADA systems, PLCs, and other operational technology.
 */
export const AssetControlDeviceSchema = BaseAssetSchema.extend({
  // Override type to be specific
  type: z.literal('control-device'),
  
  // Vendor information
  vendor: z.string().optional(),
  model: z.string().optional(),
  firmware: z.string().optional(),
  serialNumber: z.string().optional(),
  
  // Device classification
  deviceClass: z.enum([
    'plc',           // Programmable Logic Controller
    'rtu',           // Remote Terminal Unit
    'hmi',           // Human Machine Interface
    'scada',         // SCADA system
    'dcs',           // Distributed Control System
    'ied',           // Intelligent Electronic Device
    'sensor',        // Sensor/monitor
    'actuator',      // Actuator/controller
    'other'
  ]).optional(),
  
  // Protocol information
  protocols: z.array(z.string()).optional().default([]), // Modbus, DNP3, etc.
  
  // Network addressing
  ipAddress: z.string().optional(),
  
  // Status and health
  status: z.enum(['operational', 'degraded', 'offline', 'maintenance', 'unknown']).optional(),
  healthScore: z.number().min(0).max(100).optional(),
  
  // Process information
  process: z.object({
    name: z.string().optional(),
    criticalityLevel: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    function: z.string().optional(),
  }).optional(),
  
  // Safety and compliance
  certifications: z.array(z.string()).optional().default([]),
  safetyRating: z.string().optional(), // SIL rating, etc.
  
  // Vendor-specific and additional data
  extendedData: z.record(z.string(), z.any()).optional().default({}),
});

export type AssetControlDevice = z.infer<typeof AssetControlDeviceSchema>;

// Version 1 of the schema
export const AssetControlDeviceSchemaV1 = AssetControlDeviceSchema;
