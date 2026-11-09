import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { getShopify } from "../shopify.server";

export const loader = async ({ request, context }: LoaderFunctionArgs) => {
  await getShopify(context.cloudflare.env).authenticate.admin(request);
  return null;
};

export const headers: HeadersFunction = boundary.headers;
