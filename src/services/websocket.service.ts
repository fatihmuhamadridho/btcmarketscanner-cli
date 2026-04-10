import { BASE_API_WEBSOCKET_BINANCE } from '@configs/base.config';

const DEFAULT_FUTURES_WEBSOCKET_BASE_URL = 'wss://fstream.binance.com/ws';

export type WebsocketEventHandler = (event: MessageEvent<string>) => void;

export interface WebsocketServiceOptions {
  baseURL?: string;
  protocols?: string | string[];
}

export class WebsocketService {
  private socket: WebSocket | null = null;
  private readonly options: WebsocketServiceOptions;
  private readonly messageHandlers = new Set<WebsocketEventHandler>();

  constructor(options?: WebsocketServiceOptions) {
    this.options = { ...options };
  }

  private resolveUrl(path = "") {
    if (path.startsWith("ws://") || path.startsWith("wss://")) {
      return path;
    }

    const baseUrl = this.options.baseURL ?? BASE_API_WEBSOCKET_BINANCE ?? DEFAULT_FUTURES_WEBSOCKET_BASE_URL;
    const normalizedBaseUrl = baseUrl.endsWith("/")
      ? baseUrl.slice(0, -1)
      : baseUrl;
    if (!path) return normalizedBaseUrl;

    const normalizedPath = path.startsWith("/") ? path : `/${path}`;

    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  connect(path = "") {
    if (typeof WebSocket === "undefined") {
      throw new Error("WebSocket is not available in this runtime.");
    }

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return this.socket;
    }

    this.socket = new WebSocket(this.resolveUrl(path), this.options.protocols);
    this.socket.addEventListener("message", this.handleMessage);

    return this.socket;
  }

  private readonly handleMessage = (event: MessageEvent<string>) => {
    for (const handler of this.messageHandlers) {
      handler(event);
    }
  };

  onMessage(handler: WebsocketEventHandler) {
    this.messageHandlers.add(handler);

    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  send(data: string | Record<string, unknown>) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket connection is not open.");
    }

    this.socket.send(typeof data === "string" ? data : JSON.stringify(data));
  }

  close(code?: number, reason?: string) {
    if (!this.socket) return;

    this.socket.removeEventListener("message", this.handleMessage);
    this.socket.close(code, reason);
    this.socket = null;
    this.messageHandlers.clear();
  }

  get readyState() {
    return this.socket?.readyState ?? WebSocket.CLOSED;
  }

  get instance() {
    return this.socket;
  }
}
