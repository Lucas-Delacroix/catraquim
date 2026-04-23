export interface CodexRpcRequestMessage {
  id: number;
  method: string;
  params?: unknown;
}

export interface CodexRpcNotificationMessage {
  method: string;
  params?: unknown;
}

export interface CodexRpcResponseMessage {
  id: number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
  };
}

export type CodexRpcMessage =
  | CodexRpcRequestMessage
  | CodexRpcNotificationMessage
  | CodexRpcResponseMessage;

export function isRpcResponse(msg: unknown): msg is CodexRpcResponseMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    !('method' in msg)
  );
}

export function isRpcRequest(msg: unknown): msg is CodexRpcRequestMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'id' in msg &&
    'method' in msg
  );
}

export function isRpcNotification(
  msg: unknown
): msg is CodexRpcNotificationMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'method' in msg &&
    !('id' in msg)
  );
}
