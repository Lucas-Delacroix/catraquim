import type { Adapter } from '../adapters/base.js';
import { messageFromUnknownError } from '../errors.js';
import { logger } from '../logger.js';

export class GetProviderStatusesUseCase {
  public constructor(private readonly providers: Adapter[]) {}

  private async getProviderStatus(provider: Adapter) {
    try {
      const { id: _id, ...status } = await provider.status();
      return [provider.id, status] as const;
    } catch (error) {
      logger.warn(
        { err: error, providerId: provider.id },
        'Provider status check failed'
      );

      return [
        provider.id,
        {
          message: messageFromUnknownError(error, 'Status check failed'),
          ok: false,
        },
      ] as const;
    }
  }

  public async execute() {
    const statuses = await Promise.all(
      this.providers.map((provider) => this.getProviderStatus(provider))
    );

    return Object.fromEntries(statuses);
  }
}
