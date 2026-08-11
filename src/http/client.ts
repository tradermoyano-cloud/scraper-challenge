import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
} from "axios";
import { wrapper } from "axios-cookiejar-support";
import { CookieJar } from "tough-cookie";
import { logger } from "../logger";

export interface HttpClientOptions {
  baseURL?: string;
  delayMs?: number;
  maxRetries?: number;
  timeoutMs?: number;
  userAgent?: string;
}

export class RateLimitError extends Error {
  readonly status = 429;

  constructor(message = "HTTP 429 Too Many Requests") {
    super(message);
    this.name = "RateLimitError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(ms: number): number {
  const spread = Math.floor(ms * 0.25);
  return ms + Math.floor(Math.random() * (spread + 1));
}

function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableNetwork(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return (
    error.code === "ECONNRESET" ||
    error.code === "ETIMEDOUT" ||
    error.code === "ECONNABORTED" ||
    error.code === "ENOTFOUND"
  );
}

/**
 * Cliente HTTP con jar de cookies, delay entre requests
 * y reintentos con backoff exponencial (especialmente para 429).
 */
export class HttpClient {
  readonly jar: CookieJar;
  readonly axios: AxiosInstance;
  private readonly delayMs: number;
  private readonly maxRetries: number;
  private lastRequestAt = 0;

  constructor(options: HttpClientOptions = {}) {
    this.jar = new CookieJar();
    this.delayMs = options.delayMs ?? 750;
    this.maxRetries = options.maxRetries ?? 5;

    this.axios = wrapper(
      axios.create({
        baseURL: options.baseURL,
        timeout: options.timeoutMs ?? 60_000,
        jar: this.jar,
        withCredentials: true,
        maxRedirects: 5,
        validateStatus: () => true,
        headers: {
          "User-Agent":
            options.userAgent ??
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "es-PE,es;q=0.9,en;q=0.8",
        },
        transitional: { forcedJSONParsing: false },
      })
    );
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastRequestAt;
    const wait = this.delayMs - elapsed;
    if (wait > 0) {
      await sleep(jitter(wait));
    }
    this.lastRequestAt = Date.now();
  }

  async request<T = string>(
    config: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt <= this.maxRetries) {
      await this.throttle();
      try {
        const response = await this.axios.request<T>(config);

        if (isRetryableStatus(response.status)) {
          attempt += 1;
          if (attempt > this.maxRetries) {
            if (response.status === 429) {
              throw new RateLimitError(
                `429 agotó ${this.maxRetries} reintentos en ${config.url ?? ""}`
              );
            }
            return response;
          }

          const retryAfterHeader = response.headers?.["retry-after"];
          const retryAfterSeconds = retryAfterHeader
            ? Number.parseInt(String(retryAfterHeader), 10)
            : NaN;
          const backoffMs = Number.isFinite(retryAfterSeconds)
            ? retryAfterSeconds * 1000
            : Math.min(60_000, 1000 * 2 ** (attempt - 1));

          logger.warn(
            `HTTP ${response.status}: reintento ${attempt}/${this.maxRetries}`,
            { backoffMs, url: config.url }
          );
          await sleep(jitter(backoffMs));
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        if (error instanceof RateLimitError) throw error;

        attempt += 1;
        if (attempt > this.maxRetries || !isRetryableNetwork(error)) {
          throw error;
        }

        const backoffMs = Math.min(60_000, 1000 * 2 ** (attempt - 1));
        logger.warn(
          `Error de red: reintento ${attempt}/${this.maxRetries}`,
          { backoffMs, url: config.url }
        );
        await sleep(jitter(backoffMs));
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Request falló sin detalle");
  }

  get<T = string>(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({ ...config, method: "GET", url, responseType: "text" });
  }

  post<T = string>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<T>> {
    return this.request<T>({
      ...config,
      method: "POST",
      url,
      data,
      responseType: config?.responseType ?? "text",
    });
  }

  /** Descarga binaria (PDFs) con la misma política de 429/backoff. */
  async downloadBinary(
    url: string,
    config?: AxiosRequestConfig
  ): Promise<AxiosResponse<ArrayBuffer>> {
    return this.request<ArrayBuffer>({
      ...config,
      url,
      method: config?.method ?? "GET",
      responseType: "arraybuffer",
      headers: {
        Accept: "application/pdf,application/octet-stream,*/*",
        ...(config?.headers ?? {}),
      },
    });
  }

  asAxiosError(error: unknown): AxiosError | null {
    return axios.isAxiosError(error) ? error : null;
  }
}
