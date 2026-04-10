import { BASE_API_WEBSOCKET_BINANCE } from '../configs/base.config.js';
const DEFAULT_FUTURES_WEBSOCKET_BASE_URL = 'wss://fstream.binance.com/ws';
export class WebsocketService {
    socket = null;
    options;
    messageHandlers = new Set();
    constructor(options) {
        this.options = { ...options };
    }
    resolveUrl(path = "") {
        if (path.startsWith("ws://") || path.startsWith("wss://")) {
            return path;
        }
        const baseUrl = this.options.baseURL ?? BASE_API_WEBSOCKET_BINANCE ?? DEFAULT_FUTURES_WEBSOCKET_BASE_URL;
        const normalizedBaseUrl = baseUrl.endsWith("/")
            ? baseUrl.slice(0, -1)
            : baseUrl;
        if (!path)
            return normalizedBaseUrl;
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
    handleMessage = (event) => {
        for (const handler of this.messageHandlers) {
            handler(event);
        }
    };
    onMessage(handler) {
        this.messageHandlers.add(handler);
        return () => {
            this.messageHandlers.delete(handler);
        };
    }
    send(data) {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
            throw new Error("WebSocket connection is not open.");
        }
        this.socket.send(typeof data === "string" ? data : JSON.stringify(data));
    }
    close(code, reason) {
        if (!this.socket)
            return;
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
