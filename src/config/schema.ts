import { z } from 'zod';

const portSchema = z.number().int().min(1).max(65_535);
const loopbackHostnames = new Set(['localhost', '::1']);

const isLoopbackHost = (host: string) => {
  const normalizedHost = host.trim().toLowerCase();

  if (loopbackHostnames.has(normalizedHost)) {
    return true;
  }

  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalizedHost)) {
    return normalizedHost.split('.').every((octet) => Number(octet) <= 255);
  }

  return false;
};

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

export const appConfigSchema = z
  .object({
    server: z.object({
      host: z.string().trim().min(1),
      port: portSchema,
      token: z.string().min(1).nullable(),
    }),
    models: z.record(z.string(), modelConfigSchema),
    providers: z.record(z.string(), providerConfigSchema),
  })
  .superRefine((config, ctx) => {
    for (const [alias, model] of Object.entries(config.models)) {
      if (config.providers[model.adapter]) {
        continue;
      }

      ctx.addIssue({
        code: 'custom',
        message: `Model alias "${alias}" references unknown provider "${model.adapter}"`,
        path: ['models', alias, 'adapter'],
      });
    }

    if (!config.server.token && !isLoopbackHost(config.server.host)) {
      ctx.addIssue({
        code: 'custom',
        message: 'server.token is required when server.host is not loopback',
        path: ['server', 'token'],
      });
    }
  });

export type AppConfig = z.infer<typeof appConfigSchema>;
export type ClaudeCodeProviderConfig = z.infer<
  typeof claudeCodeProviderConfigSchema
>;
export type CodexProviderConfig = z.infer<typeof codexProviderConfigSchema>;
export type ModelConfig = z.infer<typeof modelConfigSchema>;
export type ProviderConfig = z.infer<typeof providerConfigSchema>;
