const MAX_RANGE_BYTES = 16 * 1024 * 1024;

export interface ExactRangeResult {
  bytes: Uint8Array;
  totalLength: number;
  attempts: number;
  status: 206;
  contentRange: string | null;
  responseType: Response['type'];
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel('Unexpected full-object response; bounded retry only');
  } catch {
    // Aborting the associated request may already have cancelled the stream.
  }
}

async function readBoundedBody(response: Response, expectedLength: number): Promise<Uint8Array> {
  if (!response.body) throw new Error('Range response has no body');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > expectedLength) {
        await reader.cancel('Range body exceeds requested byte count');
        throw new Error('Range body exceeds requested byte count');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (size !== expectedLength) throw new Error(`Range body length ${size} does not match expected ${expectedLength}`);
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function fetchExactRange(
  url: string,
  start: number,
  end: number,
  fetcher: FetchLike = fetch,
  corsFallbackTotalLength?: number,
): Promise<ExactRangeResult> {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    throw new RangeError('Range must use safe, nonnegative inclusive byte offsets');
  }
  const expectedLength = end - start + 1;
  if (expectedLength > MAX_RANGE_BYTES) throw new RangeError(`Range exceeds ${MAX_RANGE_BYTES} byte safety cap`);

  for (let attempts = 1; attempts <= 2; attempts++) {
    const controller = new AbortController();
    let response: Response;
    try {
      response = await fetcher(url, {
        headers: { Range: `bytes=${start}-${end}` },
        signal: controller.signal,
        cache: 'no-store',
      });
    } catch (error) {
      controller.abort();
      throw error;
    }

    if (response.status === 200) {
      await cancelBody(response);
      controller.abort();
      if (attempts === 2) throw new Error('Server returned 200 after one retry');
      continue;
    }
    if (response.status !== 206) {
      await cancelBody(response);
      controller.abort();
      throw new Error(`Expected HTTP 206 for byte range, received ${response.status}`);
    }

    const contentEncoding = response.headers.get('Content-Encoding');
    if (contentEncoding && contentEncoding.toLowerCase() !== 'identity') {
      await cancelBody(response);
      controller.abort();
      throw new Error(`Unexpected Content-Encoding for byte range: ${contentEncoding}`);
    }
    const contentRange = response.headers.get('Content-Range');
    let totalLength: number;
    if (contentRange === null && response.type === 'cors') {
      const contentLength = response.headers.get('Content-Length');
      if (corsFallbackTotalLength === undefined || contentLength === null || Number(contentLength) !== expectedLength) {
        await cancelBody(response);
        controller.abort();
        throw new Error('CORS response hides Content-Range; require a known object length and exact Content-Length');
      }
      totalLength = corsFallbackTotalLength;
    } else {
      const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i);
      if (!match || Number(match[1]) !== start || Number(match[2]) !== end) {
        await cancelBody(response);
        controller.abort();
        throw new Error(`Content-Range does not exactly match bytes ${start}-${end}; received ${contentRange === null ? 'unexposed/missing header' : JSON.stringify(contentRange)}`);
      }
      totalLength = Number(match[3]);
    }
    if (!Number.isSafeInteger(totalLength) || totalLength <= end) {
      await cancelBody(response);
      controller.abort();
      throw new Error('Content-Range has an invalid total object length');
    }
    const contentLength = response.headers.get('Content-Length');
    if ((response.type === 'cors' && contentLength === null) || (contentLength !== null && Number(contentLength) !== expectedLength)) {
      await cancelBody(response);
      controller.abort();
      throw new Error('Content-Length does not match requested byte count');
    }

    try {
      const bytes = await readBoundedBody(response, expectedLength);
      return { bytes, totalLength, attempts, status: 206, contentRange, responseType: response.type };
    } finally {
      controller.abort();
    }
  }
  throw new Error('Range request failed');
}
