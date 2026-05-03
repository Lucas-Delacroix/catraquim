import { describe, expect, it } from 'vitest';

import { ClaudeCodeAdapter } from '../src/adapters/claude-code/index.js';
import { CodexAdapter } from '../src/adapters/codex/index.js';
import { modelKey, parseModelRef } from '../src/application/model-ref.js';
import { ProviderFactory } from '../src/application/provider-factory.js';
import { ProviderModelCatalog } from '../src/application/provider-model-catalog.js';
import {
  defaultCodexProvider,
  findFirstProviderByType,
  providerEntries,
} from '../src/config/providers.js';
import type { AppConfig } from '../src/config/schema.js';
import { AppError } from '../src/errors.js';

describe('model refs', () => {
  it('builds and parses provider/model references', () => {
    expect(modelKey('codex', 'gpt-5.4')).toBe('codex/gpt-5.4');
    expect(parseModelRef(' codex / gpt-5.4 ')).toEqual({
      model: 'gpt-5.4',
      providerId: 'codex',
    });
  });

  it.each(['', '   ', 'codex', '/gpt-5.4', 'codex/', ' / '])(
    'rejects invalid model reference %j',
    (raw) => {
      expect(parseModelRef(raw)).toBeNull();
    }
  );
});

describe('provider config helpers', () => {
  const providers: AppConfig['providers'] = {
    claude: {
      binary: 'claude',
      homePath: '~/.claude',
      type: 'claude-code',
    },
    codex: {
      binary: 'codex',
      homePath: '~/.codex',
      type: 'codex',
    },
  };

  it('lists provider entries and finds the first provider by type', () => {
    expect(providerEntries(providers)).toEqual([
      { config: providers.claude, id: 'claude' },
      { config: providers.codex, id: 'codex' },
    ]);

    expect(findFirstProviderByType(providers, 'codex')).toEqual({
      config: providers.codex,
      id: 'codex',
    });
  });

  it('returns a default Codex provider config', () => {
    expect(defaultCodexProvider()).toEqual({
      config: {
        binary: 'codex',
        homePath: '~/.codex',
        type: 'codex',
      },
      id: 'codex',
    });
  });
});

describe('ProviderModelCatalog', () => {
  it('catalogs known model IDs per provider type', () => {
    const catalog = new ProviderModelCatalog({
      claude: {
        binary: 'claude',
        homePath: '~/.claude',
        type: 'claude-code',
      },
      codex: {
        binary: 'codex',
        homePath: '~/.codex',
        type: 'codex',
      },
    });

    expect(catalog.has('codex', 'codex-max')).toBe(true);
    expect(catalog.has('claude', 'opus')).toBe(true);
    expect(catalog.has('codex', 'opus')).toBe(false);
    expect(catalog.has('unknown', 'codex-max')).toBe(false);
    expect(catalog.listForProvider('missing')).toEqual([]);
    expect(catalog.list()).toContainEqual({
      canonicalRef: 'codex/gpt-5.4',
      modelId: 'gpt-5.4',
      providerId: 'codex',
    });
  });
});

describe('ProviderFactory', () => {
  it('creates adapters for supported provider types', () => {
    const adapters = new ProviderFactory().create({
      models: {},
      providers: {
        claude: {
          binary: 'claude',
          homePath: '~/.claude',
          type: 'claude-code',
        },
        codex: {
          binary: 'codex',
          homePath: '~/.codex',
          type: 'codex',
        },
      },
      server: {
        host: '127.0.0.1',
        port: 4141,
        token: null,
      },
    });

    expect(adapters).toHaveLength(2);
    expect(adapters[0]).toBeInstanceOf(ClaudeCodeAdapter);
    expect(adapters[0]?.id).toBe('claude');
    expect(adapters[1]).toBeInstanceOf(CodexAdapter);
    expect(adapters[1]?.id).toBe('codex');
  });

  it('throws a configuration error for unsupported provider types', () => {
    expect(() =>
      new ProviderFactory().create({
        models: {},
        providers: {
          custom: {
            binary: 'custom',
            homePath: '~/.custom',
            type: 'custom',
          } as AppConfig['providers'][string],
        },
        server: {
          host: '127.0.0.1',
          port: 4141,
          token: null,
        },
      })
    ).toThrow(AppError);
  });
});
