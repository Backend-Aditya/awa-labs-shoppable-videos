import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";

import styles from "./styles.module.css";

// Public landing page (outside the Shopify admin). Merchants install from
// the Shopify App Store, never by typing a shop domain here — App Store
// review rejects manual-domain install forms. Requests that already carry
// a shop (e.g. after install) go straight into the embedded app.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  // eslint-disable-next-line no-undef
  return { listingUrl: process.env.APP_STORE_LISTING_URL || "https://apps.shopify.com" };
};

const FEATURES = [
  {
    title: "Shoppable video, everywhere",
    body: "Filmstrips on product pages, a stacked carousel, stories, a featured video, a floating player and an add-to-cart row — each built for its place on the page.",
  },
  {
    title: "Add to cart without leaving the video",
    body: "Tagged products open beside the video with variants, sale prices and quick add, so shoppers buy what they just watched.",
  },
  {
    title: "Know what sells",
    body: "Views, product clicks and sales per video, so you can put your best content where it earns the most.",
  },
];

export default function Landing() {
  const { listingUrl } = useLoaderData<typeof loader>();
  return (
    <main className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Shoppable videos for your Shopify store</h1>
        <p className={styles.text}>Turn the videos you already make into a place to shop.</p>
        <a className={styles.button} href={listingUrl}>
          Get the app on the Shopify App Store
        </a>
        <ul className={styles.list}>
          {FEATURES.map((feature) => (
            <li key={feature.title}>
              <strong>{feature.title}.</strong> {feature.body}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
