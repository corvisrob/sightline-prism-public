import { z } from 'zod';

/**
 * BaseFlow - Schema for network flows and data transfers
 * 
 * Represents communication or data transfer between assets or systems.
 * Used for future network mapping and traffic analysis.
 */
export const BaseFlowSchema = z.object({
  // Unique identifier
  id: z.string().min(1),
  
  // Source asset/system ID
  source: z.string().min(1),
  
  // Destination asset/system ID
  destination: z.string().min(1),
  
  // Protocol (TCP, UDP, HTTP, HTTPS, etc.)
  protocol: z.string().min(1),
  
  // Port number (if applicable)
  port: z.number().int().positive().optional(),
  
  // When this flow was observed
  observedAt: z.string().datetime(),
  
  // Schema version
  schemaVersion: z.number().int().positive(),
  
  // Optional description
  description: z.string().optional(),
  
  // Flow metadata
  metadata: z.object({
    bytes: z.number().optional(),
    packets: z.number().optional(),
    duration: z.number().optional(), // seconds
    state: z.enum(['active', 'inactive', 'intermittent']).optional(),
  }).optional(),
  
  // Optional tags
  tags: z.array(z.string()).optional().default([]),
});

export type BaseFlow = z.infer<typeof BaseFlowSchema>;
