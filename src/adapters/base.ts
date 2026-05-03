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

export type ToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { function: { name: string }; type: 'function' };

export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      json_schema: {
        description?: string;
        name: string;
        schema?: Record<string, unknown>;
        strict?: boolean;
      };
      type: 'json_schema';
    };

export interface ChatRequest {
  frequencyPenalty?: number;
  maxTokens?: number;
  messages: ChatMessage[];
  model: string;
  presencePenalty?: number;
  reasoningEffort?: ReasoningEffort;
  responseFormat?: ResponseFormat;
  stream: boolean;
  stop?: string[];
  temperature?: number;
  toolChoice?: ToolChoice;
  topP?: number;
  tools?: ToolDefinition[];
  user?: string;
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
