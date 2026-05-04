import { describe, expect, it } from 'vitest';

import type { Adapter, AdapterStatus } from '../src/adapters/base.js';
import { ModelRegistry } from '../src/application/model-registry.js';
import { ProviderModelCatalog } from '../src/application/provider-model-catalog.js';
import type { AppConfig } from '../src/config/schema.js';
import { AppError } from '../src/errors.js';
import { CompleteChatUseCase } from '../src/usecases/complete-chat.js';
import { ListModelsUseCase } from '../src/usecases/list-models.js';

export interface ProviderContractOptions {
  alias: string;
  canonicalModel: string;
  config: AppConfig;
  createAdapter: () => Adapter;
  createFailureAdapter?: () => Adapter;
  expectedContent: string;
  expectedStatus: Partial<AdapterStatus>;
  providerId: string;
}

export const defineProviderContract = (
  name: string,
  options: ProviderContractOptions
) => {
  describe(`${name} provider contract`, () => {
    const createRegistry = () =>
      new ModelRegistry(
        options.config.models,
        options.config.providers,
        new ProviderModelCatalog(options.config.providers)
      );

    it('lists aliases and canonical provider/model refs', () => {
      const listModels = new ListModelsUseCase(
        createRegistry(),
        new ProviderModelCatalog(options.config.providers)
      );

      expect(listModels.execute()).toEqual(
        expect.arrayContaining([
          {
            canonical_ref: options.canonicalModel,
            id: options.alias,
            object: 'model',
            owned_by: options.providerId,
            source: 'configured-alias',
          },
          {
            canonical_ref: options.canonicalModel,
            id: options.canonicalModel,
            object: 'model',
            owned_by: options.providerId,
            source: 'provider-catalog',
          },
        ])
      );
    });

    it('validates direct provider/model refs against the provider catalog', () => {
      const registry = createRegistry();

      expect(registry.resolve(options.canonicalModel)).toMatchObject({
        canonicalModel: options.canonicalModel,
        providerId: options.providerId,
      });

      expect(() =>
        registry.resolve(`${options.providerId}/not-in-catalog`)
      ).toThrow(AppError);

      try {
        registry.resolve(`${options.providerId}/not-in-catalog`);
      } catch (error) {
        expect(error).toMatchObject({
          code: 'unknown_model',
          requestedModel: `${options.providerId}/not-in-catalog`,
          type: 'compatibility_error',
        });
      }
    });

    it('responds with provider status', async () => {
      const status = await options.createAdapter().status();
      expect(status).toMatchObject(options.expectedStatus);
    });

    it('executes completion with canonical model metadata', async () => {
      const useCase = new CompleteChatUseCase(createRegistry(), [
        options.createAdapter(),
      ]);

      const result = await useCase.execute(
        {
          messages: [{ content: 'hello', role: 'user' }],
          model: options.alias,
          stream: false,
        },
        new AbortController().signal
      );

      expect(result).toMatchObject({
        canonicalModel: options.canonicalModel,
        content: options.expectedContent,
        providerId: options.providerId,
        requestedModel: options.alias,
      });
    });

    const createFailureAdapter = options.createFailureAdapter;
    if (createFailureAdapter) {
      it('classifies provider failures with canonical metadata', async () => {
        const useCase = new CompleteChatUseCase(createRegistry(), [
          createFailureAdapter(),
        ]);

        await expect(
          useCase.execute(
            {
              messages: [{ content: 'hello', role: 'user' }],
              model: options.alias,
              stream: false,
            },
            new AbortController().signal
          )
        ).rejects.toMatchObject({
          canonicalModel: options.canonicalModel,
          code: 'provider_request_failed',
          providerId: options.providerId,
          requestedModel: options.alias,
          statusCode: 502,
          type: 'provider_error',
        });
      });
    }
  });
};
