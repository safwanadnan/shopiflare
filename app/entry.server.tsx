import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";
import type { AppLoadContext, EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _loadContext?: AppLoadContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const userAgent = request.headers.get("user-agent");

  const body = await renderToReadableStream(
    <ServerRouter
      context={reactRouterContext}
      url={request.url}
    />,
    {
      signal: request.signal,
      onError(error: unknown) {
        responseStatusCode = 500;
        console.error(error);
      },
    },
  );

  if (isbot(userAgent || "")) {
    await body.allReady;
  }

  responseHeaders.set("Content-Type", "text/html");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
