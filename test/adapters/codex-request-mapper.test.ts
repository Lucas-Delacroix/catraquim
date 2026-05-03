import { describe, expect, it } from 'vitest';

import { toTurnBaseParams } from '../../src/adapters/codex/request-mapper.js';

describe('toTurnBaseParams', () => {
  it('serializes OpenAI content parts into readable text for Codex turns', () => {
    const result = toTurnBaseParams(
      {
        messages: [
          {
            content: [
              { text: 'Describe this:', type: 'text' },
              {
                image_url: { url: 'https://example.com/image.png' },
                type: 'image_url',
              },
            ],
            role: 'user',
          },
        ],
        model: 'codex-max',
        stream: false,
      },
      'codex-max',
      {
        cwd: '/work',
        serviceName: 'test-service',
      }
    );

    expect(result.input).toEqual([
      {
        text: 'user: Describe this:\n[image_url: https://example.com/image.png]',
        type: 'text',
      },
    ]);
  });
});
