import { z } from 'zod';

/** Request payload schemas shared by the API (validation) and the client (forms). */

export const incidentTypeSchema = z.enum([
  'cardiac',
  'stroke',
  'trauma',
  'road_accident',
  'fire',
  'hazmat',
  'crime',
  'medical',
]);

export const unitKindSchema = z.enum(['ambulance', 'fire', 'police']);
export const userRoleSchema = z.enum(['admin', 'supervisor', 'dispatcher', 'hospital']);

export const loginSchema = z.object({
  username: z.string().trim().min(3).max(40),
  password: z.string().min(6).max(128),
});

export const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(40)
    .regex(/^[a-zA-Z0-9._-]+$/, 'Use letters, numbers, dot, dash or underscore'),
  name: z.string().trim().min(2).max(80),
  password: z
    .string()
    .min(8, 'At least 8 characters')
    .max(128)
    .regex(/[A-Za-z]/, 'Include a letter')
    .regex(/[0-9]/, 'Include a number'),
  zone: z.string().trim().min(2).max(60).default('Central Zone'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: registerSchema.shape.password,
});

export const updateUserSchema = z.object({
  role: userRoleSchema.optional(),
  zone: z.string().trim().min(2).max(60).optional(),
  name: z.string().trim().min(2).max(80).optional(),
});

export const createIncidentSchema = z.object({
  type: incidentTypeSchema,
  nodeId: z.string().min(1),
  severity: z.number().int().min(1).max(5).optional(),
  callerName: z.string().trim().max(80).optional().nullable(),
  callerPhone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+0-9 ()-]*$/, 'Invalid phone number')
    .optional()
    .nullable(),
  notes: z.string().trim().max(500).default(''),
  source: z.enum(['erss_112', 'cctv', 'gps_iot', 'manual']).default('erss_112'),
  autoDispatch: z.boolean().optional(),
});

export const dispatchSchema = z.object({
  /** Explicit unit ids. When omitted the AI recommendation is applied. */
  unitIds: z.array(z.string()).max(8).optional(),
});

export const signalOverrideSchema = z.object({
  mode: z.enum(['force_ns', 'force_ew', 'flash', 'release']),
});

export const blockageSchema = z.object({
  edgeId: z.string().min(1),
  reason: z.string().trim().max(120).default('Road blocked'),
});

export const bedUpdateSchema = z.object({
  ward: z.enum(['icu', 'emergency']),
  occupied: z.number().int().min(0).max(500).optional(),
  total: z.number().int().min(1).max(500).optional(),
  status: z.enum(['normal', 'busy', 'diverting']).optional(),
});

export const simulationSettingsSchema = z.object({
  running: z.boolean().optional(),
  speed: z.number().min(0.5).max(20).optional(),
  corridorEnabled: z.boolean().optional(),
  autoIncidents: z.boolean().optional(),
  autoDispatch: z.boolean().optional(),
  vehicleAuth: z.boolean().optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type CreateIncidentInput = z.input<typeof createIncidentSchema>;
export type DispatchInput = z.infer<typeof dispatchSchema>;
export type SignalOverrideInput = z.infer<typeof signalOverrideSchema>;
export type BlockageInput = z.input<typeof blockageSchema>;
export type BedUpdateInput = z.infer<typeof bedUpdateSchema>;
export type SimulationSettingsInput = z.infer<typeof simulationSettingsSchema>;
