export interface ModelRef {
  model: string;
  providerId: string;
}

export const modelKey = (providerId: string, model: string) =>
  `${providerId}/${model}`;

export const parseModelRef = (raw: string): ModelRef | null => {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const slashIndex = trimmed.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }

  const providerId = trimmed.slice(0, slashIndex).trim();
  const model = trimmed.slice(slashIndex + 1).trim();

  if (!providerId || !model) {
    return null;
  }

  return {
    model,
    providerId,
  };
};
