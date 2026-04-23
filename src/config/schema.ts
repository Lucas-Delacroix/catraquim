import { z } from 'zod';

export const modelConfigSchema = z.object({
  adapter: z.string().min(1),
  upstreamModel: z.string().min(1),
});

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    token: z.string().min(1).nullable(),
  }),
  models: z.record(modelConfigSchema),
  codex: z.object({
    binary: z.string().min(1),
    codexHomeSource: z.string().min(1),
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
