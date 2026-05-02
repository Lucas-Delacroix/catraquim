export interface Usage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export interface ContentTextPart {
  type: 'text';
  text: string;
}

export interface ContentImagePart {
  type: 'image_url';
  image_url: { url: string };
}

export type ContentPart = ContentTextPart | ContentImagePart;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ContentPart[];
  toolCallId?: string;
}

export interface ToolDefinition {
  function: {
    description?: string;
    name: string;
    parameters?: Record<string, unknown>;
  };
  type: 'function';
}

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ChatRequest {
  maxTokens?: number;
  messages: ChatMessage[];
  model: string;
  reasoningEffort?: ReasoningEffort;
  stream: boolean;
  temperature?: number;
  tools?: ToolDefinition[];
}

export interface ResolvedChatRequest extends ChatRequest {
  canonicalModel: string;
  providerId: string;
  upstreamModel: string;
}

export interface ChatChunk {
  delta: string;
  finishReason?: string;
  usage?: Usage;
}

export interface AdapterStatus {
  expiresAt?: string | null;
  id: string;
  message?: string;
  ok: boolean;
}

export interface Adapter {
  id: string;
  chat(req: ResolvedChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  listModels?(signal?: AbortSignal): Promise<string[]>;
  shutdown?(): void;
  status(): Promise<AdapterStatus>;
}
