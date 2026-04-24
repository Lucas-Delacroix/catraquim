import { z } from 'zod';

export const modelConfigSchema = z.object({
  adapter: z.string().min(1),
  upstreamModel: z.string().min(1),
});

export const codexProviderConfigSchema = z.object({
  type: z.literal('codex'),
  binary: z.string().min(1),
  homePath: z.string().min(1),
});

export const claudeCodeProviderConfigSchema = z.object({
  type: z.literal('claude-code'),
  binary: z.string().min(1),
  homePath: z.string().min(1),
});

export const providerConfigSchema = z.discriminatedUnion('type', [
  codexProviderConfigSchema,
  claudeCodeProviderConfigSchema,
]);

export const appConfigSchema = z.object({
  server: z.object({
    host: z.string().min(1),
    port: z.number().int().positive(),
    token: z.string().min(1).nullable(),
  }),
  models: z.record(z.string(), modelConfigSchema),
  providers: z.record(z.string(), providerConfigSchema),
});

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ClaudeCodeProviderConfig = z.infer<
  typeof claudeCodeProviderConfigSchema
>;
export type CodexProviderConfig = z.infer<typeof codexProviderConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
