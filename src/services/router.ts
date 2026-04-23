import type { Adapter } from '../adapters/base.js';
import type { ModelBinding } from '../application/model-registry.js';
import { AppError } from '../errors.js';

export class ServiceRouter {
  private readonly adaptersById: ReadonlyMap<string, Adapter>;

  public constructor(adapters: Adapter[]) {
    this.adaptersById = new Map(
      adapters.map((adapter) => [adapter.id, adapter])
    );
  }

  public resolveAdapter(binding: ModelBinding): Adapter {
    const adapter = this.adaptersById.get(binding.providerId);

    if (!adapter) {
      throw new AppError(
        `No provider configured for model "${binding.gatewayModel}"`,
        404
      );
    }

    return adapter;
  }
}
