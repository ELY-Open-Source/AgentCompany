/**
 * AWS Signature Version 4 signing for Bedrock Runtime requests. Implements the
 * canonical-request / string-to-sign / signing-key chain with node:crypto so no
 * AWS SDK is needed.
 */
import { createHash, createHmac } from "node:crypto";

export interface AwsSigner {
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", typeof key === "string" ? Buffer.from(key, "utf8") : key).update(data, "utf8").digest();
}

/** RFC 3986 encoding used by SigV4; keeps "/" only when encodeSlash is false. */
function awsUriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const ch of value) {
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += ch;
    else out += [...Buffer.from(ch, "utf8")].map((byte) => `%${byte.toString(16).toUpperCase().padStart(2, "0")}`).join("");
  }
  return out;
}

function amzTimestamp(): { amzDate: string; dateStamp: string } {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

/**
 * Signs a request and returns the absolute (encoded) URL plus the headers to
 * send. `rawPath` is the unencoded absolute path (e.g. /model/<modelId>/converse).
 */
export function signAwsRequest(input: {
  method: string;
  host: string;
  rawPath: string;
  body: string;
  signer: AwsSigner;
}): { url: string; headers: Record<string, string> } {
  const { host, rawPath, body, signer } = input;
  const { region, service, accessKeyId, secretAccessKey, sessionToken } = signer;
  const { amzDate, dateStamp } = amzTimestamp();
  const canonicalUri = awsUriEncode(rawPath, false);
  const payloadHash = sha256Hex(body);

  const baseHeaders: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (sessionToken) baseHeaders["x-amz-security-token"] = sessionToken;

  const sortedHeaderKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = sortedHeaderKeys.map((key) => `${key}:${baseHeaders[key].trim()}\n`).join("");
  const signedHeaders = sortedHeaderKeys.join(";");
  const canonicalRequest = [input.method, canonicalUri, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");

  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");

  // `host` is signed but not returned: fetch sets the Host header from the URL.
  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      ...(sessionToken ? { "x-amz-security-token": sessionToken } : {}),
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
