import type { ActionFunctionArgs } from "react-router";
import { uninstallShopifyCredentials } from "../services/shopify-auth-state.server";
import { verifyShopifyWebhook } from "../services/shopify-webhook-auth.server";

export const action = async ({ request, context }: ActionFunctionArgs) => {
  const env = context.cloudflare.env;
  const { shop } = await verifyShopifyWebhook(request, env, ["app/uninstalled"]);
  await uninstallShopifyCredentials(env, shop, request.headers.get("x-shopify-triggered-at"));
  return new Response(null, { status: 204 });
};
