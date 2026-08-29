export interface RawHttpRequest {
  method: "GET" | "POST" | "PATCH";
  url: URL;
  headers: Record<string, string>;
  body?: Uint8Array;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RawHttpResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
}

export interface HttpTransport {
  send(request: RawHttpRequest): Promise<RawHttpResponse>;
}

export class FetchHttpTransport implements HttpTransport {
  async send(request: RawHttpRequest): Promise<RawHttpResponse> {
    const signal = request.signal
      ? AbortSignal.any([
          AbortSignal.timeout(request.timeoutMs),
          request.signal,
        ])
      : AbortSignal.timeout(request.timeoutMs);
    const response = await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      body: request.body ? Buffer.from(request.body) : undefined,
      signal,
    });
    return {
      status: response.status,
      headers: response.headers,
      body: new Uint8Array(await response.arrayBuffer()),
    };
  }
}
