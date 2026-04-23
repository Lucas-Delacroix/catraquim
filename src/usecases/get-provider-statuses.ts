import type { Adapter } from '../adapters/base.js';

export class GetProviderStatusesUseCase {
  public constructor(private readonly providers: Adapter[]) {}

  public async execute() {
    const statuses = await Promise.all(
      this.providers.map(async (provider) => {
        const { id: _id, ...status } = await provider.status();
        return [provider.id, status] as const;
      })
    );

    return Object.fromEntries(statuses);
  }
}
