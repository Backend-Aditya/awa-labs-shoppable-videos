import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  // Allow cross-origin requests from the storefront
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  // The storefront might not be authenticated with admin token, but using public proxy or app proxy.
  // Actually, since it's a theme app extension, the request comes from the storefront.
  // Using App Proxy is one way, or we can use CORS if we allow any origin.
  // For simplicity, let's allow CORS and use the shop domain from the request payload.
  
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const payload = await request.json();
    const { shopDomain, reelId, eventType } = payload;

    if (!shopDomain || !reelId || !eventType) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }

    const shop = await prisma.shop.findUnique({
      where: { shopDomain },
    });

    if (!shop) {
      return Response.json({ error: "Shop not found" }, { status: 404 });
    }

    await prisma.reelEvent.create({
      data: {
        shopId: shop.id,
        reelId,
        eventType,
      },
    });

    return Response.json(
      { success: true },
      {
        headers: {
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (error) {
    console.error("Failed to track analytics", error);
    return Response.json({ error: "Internal Server Error" }, { status: 500 });
  }
};
