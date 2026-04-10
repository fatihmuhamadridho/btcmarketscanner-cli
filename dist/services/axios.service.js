import axios from 'axios';
import { BASE_API_BINANCE } from '../configs/base.config.js';
export class AxiosService {
    client;
    options;
    constructor(options) {
        this.options = { ...options };
        this.client = axios.create({
            baseURL: this.options.baseURL ?? BASE_API_BINANCE ?? '',
        });
    }
    get(url, config) {
        return this.client.get(url, config).then((res) => res.data);
    }
    post(url, data, config) {
        return this.client.post(url, data, config).then((res) => res.data);
    }
    put(url, data, config) {
        return this.client.put(url, data, config).then((res) => res.data);
    }
    patch(url, data, config) {
        return this.client.patch(url, data, config).then((res) => res.data);
    }
    delete(url, config) {
        return this.client.delete(url, config).then((res) => res.data);
    }
    getWithResponse(url, config) {
        return this.client.get(url, config);
    }
}
