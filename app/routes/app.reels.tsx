import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { useLoaderData, useNavigation } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { generateReelHandle, listReels, upsertReel } from "../models/reel.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const reels = await listReels(admin, 50);
  return { reels };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const title = String(formData.get("title") ?? "").trim();
  const published = formData.get("published") === "on";

  if (!title) {
    return { error: "Title is required" };
  }

  await upsertReel(admin, generateReelHandle(title), title, published, {
    productIds: [],
    interactions: {},
    source: { type: "upload" },
  });

  return { error: null };
};

export default function ReelsLibrary() {
  const { reels } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <s-page heading="Reels library">
      <s-section heading="Create a reel">
        <form method="post">
          <s-stack gap="base">
            <s-text-field label="Title" name="title" required></s-text-field>
            <s-checkbox label="Published" name="published"></s-checkbox>
            <s-button
              type="submit"
              variant="primary"
              {...(isSubmitting ? { loading: true } : {})}
            >
              Create reel
            </s-button>
          </s-stack>
        </form>
      </s-section>
      <s-section heading="All reels">
        {reels.length === 0 ? (
          <s-paragraph>No reels yet. Create your first one above.</s-paragraph>
        ) : (
          <s-table variant="list">
            <s-table-header-row>
              <s-table-header listSlot="primary">Title</s-table-header>
              <s-table-header listSlot="inline">Status</s-table-header>
            </s-table-header-row>
            <s-table-body>
              {reels.map((reel) => (
                <s-table-row key={reel.id}>
                  <s-table-cell>{reel.title}</s-table-cell>
                  <s-table-cell>
                    <s-badge tone={reel.published ? "success" : "neutral"}>
                      {reel.published ? "Published" : "Draft"}
                    </s-badge>
                  </s-table-cell>
                </s-table-row>
              ))}
            </s-table-body>
          </s-table>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
