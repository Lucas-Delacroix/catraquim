export interface CodexRpcRequest {
  id: number;
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

export interface CodexRpcResponse {
  id: number;
  jsonrpc: '2.0';
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}
