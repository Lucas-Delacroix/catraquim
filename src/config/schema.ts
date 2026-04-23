import { z } from 'zod';

export const modelConfigSchema = z.object({
  adapter: z.string().min(1),
  upstreamModel: z.string().min(1),
});

export const codexProviderConfigSchema = z.object({
  binary: z.string().min(1),
  homePath: z.string().min(1),
});

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    token: z.string().min(1).nullable(),
  }),
  models: z.record(z.string(), modelConfigSchema),
  providers: z.object({
    codex: codexProviderConfigSchema,
  }),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type CodexProviderConfig = z.infer<typeof codexProviderConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
