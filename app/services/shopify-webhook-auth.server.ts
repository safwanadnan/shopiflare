const maximumBodyBytes = 1024 * 1024;

async function readBody(request: Request): Promise<ArrayBuffer> {
  if (Number(request.headers.get("content-length")) > maximumBodyBytes) {
    throw new Response("Webhook body too large", { status: 413 });
  }
  if (!request.body) throw new Response("Missing webhook body", { status: 400 });

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBodyBytes) {
        void reader.cancel().catch(() => {});
        throw new Response("Webhook body too large", { status: 413 });
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

/** Verify delivery against the raw body without looking up a merchant session. */
export async function verifyShopifyWebhook(
  request: Request,
  env: Pick<Env, "SHOPIFY_API_SECRET">,
  allowedTopics: readonly string[],
) {
  if (request.method !== "POST") throw new Response(null, { status: 405 });
  if (!env.SHOPIFY_API_SECRET) throw new Response(null, { status: 503 });

  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!/^[A-Za-z0-9+/]{43}=$/.test(hmac)) throw new Response(null, { status: 401 });

  const bytes = await readBody(request);
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(env.SHOPIFY_API_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"],
  );
  const signature = Uint8Array.from(atob(hmac), char => char.charCodeAt(0));
  if (!await crypto.subtle.verify("HMAC", key, signature, bytes)) {
    throw new Response(null, { status: 401 });
  }

  const shop = request.headers.get("x-shopify-shop-domain")?.toLowerCase() ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop) || !allowedTopics.includes(topic)) {
    throw new Response("Invalid webhook metadata", { status: 400 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Response("Invalid webhook JSON", { status: 400 });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Response("Invalid webhook payload", { status: 400 });
  }
  return { shop, topic, payload: payload as Record<string, unknown> };
}
