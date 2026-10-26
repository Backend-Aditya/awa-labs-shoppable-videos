import type { ActionFunctionArgs } from "react-router";
import { verifyWebhook } from "../lib/webhook.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
    const { payload, topic, shop } = await verifyWebhook(request);
    console.log(`Received ${topic} webhook for ${shop}`);

    const current = Array.isArray(payload.current) ? (payload.current as string[]) : [];
    // The shop's offline session, by id: nothing here needs a live token.
    await db.session.updateMany({
        where: { shop, isOnline: false },
        data: { scope: current.toString() },
    });
    return new Response();
};
