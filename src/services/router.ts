import type { Adapter } from '../adapters/base.js';
import { AppError } from '../errors.js';

export class ServiceRouter {
  public constructor(private readonly adapters: Adapter[]) {}

  public resolveAdapter(model: string): Adapter {
    const adapter = this.adapters.find((candidate) =>
      candidate.supports(model)
    );

    if (!adapter) {
      throw new AppError(`No adapter configured for model "${model}"`, 404);
    }

    return adapter;
  }
}
