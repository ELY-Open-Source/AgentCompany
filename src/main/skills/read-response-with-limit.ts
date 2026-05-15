const encoder = new TextEncoder();
const decoder = new TextDecoder();

function assertValidByteLimit(maxBytes: number): void {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new Error(`Invalid response byte limit: ${maxBytes}`);
  }
}

function validateContentLength(response: Response, maxBytes: number): void {
  const contentLengthHeader = response.headers.get("Content-Length");
  if (contentLengthHeader !== null) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new Error(`Invalid Content-Length header: ${contentLengthHeader}`);
    }
    if (contentLength > maxBytes) {
      throw new Error(`Response too large: ${contentLength} bytes (max ${maxBytes})`);
    }
  }
}

function assertWithinLimit(byteLength: number, maxBytes: number): void {
  if (byteLength > maxBytes) {
    throw new Error(`Response body exceeded ${maxBytes} bytes`);
  }
}

export async function readResponseBytesWithLimit(response: Response, maxBytes: number): Promise<Uint8Array> {
  assertValidByteLimit(maxBytes);
  validateContentLength(response, maxBytes);

  const reader = response.body?.getReader();
  if (!reader) {
    if (typeof response.arrayBuffer === "function") {
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertWithinLimit(bytes.byteLength, maxBytes);
      return bytes;
    }
    const text = await response.text();
    const bytes = encoder.encode(text);
    assertWithinLimit(bytes.byteLength, maxBytes);
    return bytes;
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      assertWithinLimit(totalBytes, maxBytes);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return body;
}

export async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string> {
  return decoder.decode(await readResponseBytesWithLimit(response, maxBytes));
}
