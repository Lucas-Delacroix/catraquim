import type { ContentPart } from './base.js';

const contentPartToText = (part: ContentPart) => {
  if (part.type === 'text') {
    return part.text;
  }

  return `[image_url: ${part.image_url.url}]`;
};

export const chatContentToText = (content: string | ContentPart[]) => {
  if (typeof content === 'string') {
    return content;
  }

  return content.map(contentPartToText).join('\n');
};
