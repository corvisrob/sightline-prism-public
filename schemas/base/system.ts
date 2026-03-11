import { z } from 'zod';

/**
 * BaseSystem - Schema for logical systems composed of multiple assets
 * 
 * Represents higher-level constructs like applications, services, or networks
 * that are composed of multiple individual assets.
 */
export const BaseSystemSchema = z.object({
  // Unique identifier
  id: z.string().min(1),
  
  // System name
  name: z.string().min(1),
  
  // System type (application, service, network, etc.)
  type: z.string().min(1),
  
  // When this system definition was created/updated
  updatedAt: z.string().datetime(),
  
  // Source of the system definition
  source: z.string().min(1),
  
  // Schema version
  schemaVersion: z.number().int().positive(),
  
  // Optional description
  description: z.string().optional(),
  
  // Component asset IDs
  components: z.array(z.string()).default([]),
  
  // Relationships to other systems
  relationships: z.array(z.object({
    targetSystemId: z.string(),
    relationshipType: z.enum(['depends-on', 'provides-to', 'connects-to', 'contains']),
    description: z.string().optional(),
  })).optional().default([]),
  
  // Optional tags
  tags: z.array(z.string()).optional().default([]),
});

export type BaseSystem = z.infer<typeof BaseSystemSchema>;
