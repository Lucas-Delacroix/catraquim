export interface Usage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
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

export interface ChatRequest {
  maxTokens?: number;
  messages: ChatMessage[];
  model: string;
  stream: boolean;
  temperature?: number;
  tools?: ToolDefinition[];
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
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatChunk>;
  shutdown?(): void;
  status(): Promise<AdapterStatus>;
  supports(model: string): boolean;
}
