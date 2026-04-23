import { describe, expect, it } from 'vitest';

import { CodexAdapter } from '../../src/adapters/codex/index.js';
import { defaultConfig } from '../../src/config/defaults.js';

describe('CodexAdapter', () => {
  it('supports models mapped to codex in config', () => {
    const adapter = new CodexAdapter(defaultConfig);

    expect(adapter.supports('gpt-5')).toBe(true);
    expect(adapter.supports('missing-model')).toBe(false);
  });
});
