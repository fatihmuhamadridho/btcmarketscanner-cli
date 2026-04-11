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
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private reconnectPath = '';

  constructor(options?: WebsocketServiceOptions) {
    this.options = { ...options };
  }

  private resolveUrl(path = '') {
    if (path.startsWith('ws://') || path.startsWith('wss://')) {
      return path;
    }

    const baseUrl = this.options.baseURL ?? BASE_API_WEBSOCKET_BINANCE() ?? DEFAULT_FUTURES_WEBSOCKET_BASE_URL;
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    if (!path) return normalizedBaseUrl;

    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${normalizedBaseUrl}${normalizedPath}`;
  }

  connect(path = '') {
    if (typeof WebSocket === 'undefined') {
      throw new Error('WebSocket is not available in this runtime.');
    }

    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return this.socket;
    }

    this.reconnectPath = path;
    this.socket = new WebSocket(this.resolveUrl(path), this.options.protocols);
    this.socket.addEventListener('message', this.handleMessage);
    this.socket.addEventListener('error', this.handleError);
    this.socket.addEventListener('close', this.handleClose);
    this.socket.addEventListener('open', this.handleOpen);

    return this.socket;
  }

  private readonly handleOpen = () => {
    this.reconnectAttempts = 0; // Reset counter on successful connection
    console.log('[websocket] Connection established successfully.');
  };

  private readonly handleError = (event: Event) => {
    console.warn('[websocket] Connection error:', event);
  };

  private readonly handleClose = (event: CloseEvent) => {
    console.warn(
      `[websocket] Connection closed (code: ${event.code}, reason: ${event.reason || 'none'}), attempting to reconnect...`,
    );
    this.attemptReconnect();
  };

  private attemptReconnect = () => {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[websocket] Max reconnection attempts reached, giving up.');
      console.error(`[websocket] Handlers still registered: ${this.messageHandlers.size}`);
      console.error(`[websocket] Last path: ${this.reconnectPath}`);
      return;
    }

    this.reconnectAttempts += 1;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    console.log(
      `[websocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) with path: ${this.reconnectPath}...`,
    );

    setTimeout(() => {
      try {
        console.log(`[websocket] Executing reconnect attempt #${this.reconnectAttempts}...`);
        this.connect(this.reconnectPath);
      } catch (error) {
        console.error('[websocket] Reconnection attempt failed:', error);
        this.attemptReconnect();
      }
    }, delay);
  };

  private readonly handleMessage = (event: MessageEvent<string>) => {
    if (this.messageHandlers.size === 0) {
      console.warn('[websocket] Message received but no handlers registered');
      return;
    }
    for (const handler of this.messageHandlers) {
      try {
        handler(event);
      } catch (error) {
        console.error('[websocket] Error in message handler:', error);
      }
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
      throw new Error('WebSocket connection is not open.');
    }

    this.socket.send(typeof data === 'string' ? data : JSON.stringify(data));
  }

  close(code?: number, reason?: string) {
    if (!this.socket) return;

    this.socket.removeEventListener('message', this.handleMessage);
    this.socket.removeEventListener('error', this.handleError);
    this.socket.removeEventListener('close', this.handleClose);
    this.socket.close(code, reason);
    this.socket = null;
    this.messageHandlers.clear();
    this.reconnectAttempts = 0; // Reset reconnect counter
  }

  get readyState() {
    return this.socket?.readyState ?? WebSocket.CLOSED;
  }

  get instance() {
    return this.socket;
  }
}
