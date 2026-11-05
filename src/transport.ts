export interface FeedpulseRequest {
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  body?: string;
}

export interface FeedpulseResponse {
  status: number;
  /** キーは小文字。 */
  headers: Record<string, string>;
  body: string;
}

/**
 * HTTP の差し替え口。通信失敗は throw する（SDK が `network` にする）。
 * `Origin` ヘッダーは付けない（付けるとサーバーが Web 経路として扱う）。
 */
export interface FeedpulseTransport {
  send(request: FeedpulseRequest): Promise<FeedpulseResponse>;
}

/** グローバル `fetch`（React Native 標準）による既定の実装。 */
export class FetchTransport implements FeedpulseTransport {
  constructor(private readonly timeoutMs = 30_000) {}

  async send(request: FeedpulseRequest): Promise<FeedpulseResponse> {
    const controller = typeof AbortController === 'function' ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), this.timeoutMs) : undefined;
    try {
      const res = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: controller?.signal,
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((v: string, k: string) => {
        headers[k.toLowerCase()] = v;
      });
      return { status: res.status, headers, body: await res.text() };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
