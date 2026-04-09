import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { BASE_API_BINANCE } from '@configs/base.config';

export interface AxiosServiceOptions {
  baseURL?: string;
}

export class AxiosService {
  private readonly client: AxiosInstance;
  private readonly options: AxiosServiceOptions;

  constructor(options?: AxiosServiceOptions) {
    this.options = { ...options };

    this.client = axios.create({
      baseURL: this.options.baseURL ?? BASE_API_BINANCE ?? '',
    });
  }

  get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.get<T>(url, config).then((res) => res.data);
  }

  post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.post<T>(url, data, config).then((res) => res.data);
  }

  put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.put<T>(url, data, config).then((res) => res.data);
  }

  patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    return this.client.patch<T>(url, data, config).then((res) => res.data);
  }

  delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    return this.client.delete<T>(url, config).then((res) => res.data);
  }

  getWithResponse<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }
}
