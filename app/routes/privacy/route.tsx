import type { HeadersFunction, MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

import styles from "./styles.module.css";

// Public privacy policy, linked from the App Store listing and the landing
// page. It describes what the app actually stores (prisma/schema.prisma,
// the storefront scripts' browser storage, the GDPR webhooks), so update it
// whenever the app starts collecting something new, and move POLICY_DATE.
// Contact details come from the environment so they can change without a
// deploy of new copy: SUPPORT_EMAIL, BUSINESS_NAME, BUSINESS_ADDRESS.
const POLICY_DATE = "October 24, 2026";
const APP_NAME = "AWAlabs Shoppable Videos";

export const loader = () => {
  /* eslint-disable no-undef */
  return {
    businessName: process.env.BUSINESS_NAME || "AWAlabs",
    businessAddress: process.env.BUSINESS_ADDRESS || null,
    supportEmail: process.env.SUPPORT_EMAIL || null,
    listingUrl: process.env.APP_STORE_LISTING_URL || "https://apps.shopify.com",
  };
  /* eslint-enable no-undef */
};

export const meta: MetaFunction = () => [
  { title: `Privacy policy · ${APP_NAME}` },
  { name: "description", content: `What ${APP_NAME} collects, how it's used, and how it's deleted.` },
];

export const headers: HeadersFunction = () => ({ "Cache-Control": "public, max-age=3600" });

export default function Privacy() {
  const { businessName, businessAddress, supportEmail, listingUrl } = useLoaderData<typeof loader>();
  return (
    <main className={styles.page}>
      <article className={styles.policy}>
        <p className={styles.eyebrow}>{APP_NAME}</p>
        <h1>Privacy policy</h1>
        <p className={styles.date}>Effective {POLICY_DATE}</p>

        <p>
          {APP_NAME} (&ldquo;the app&rdquo;) is provided by {businessName} (&ldquo;we&rdquo;, &ldquo;us&rdquo;). This policy explains what
          information the app collects when a merchant installs it, how we use it, and the choices merchants and their customers have.
        </p>

        <h2>Information we collect from merchants</h2>
        <ul>
          <li>
            <strong>Store details from Shopify.</strong> When you install the app, Shopify gives us your store&rsquo;s domain and an access
            token that lets the app act with the permissions you approved: reading and updating products, and storing the app&rsquo;s own data
            in your store. We don&rsquo;t store the names or email addresses of your staff.
          </li>
          <li>
            <strong>Content you create.</strong> Videos you upload or import, their titles, covers, tagged products and product moments;
            your widget settings and brand colors; and the IDs of tracking services you connect, such as a Microsoft Clarity project ID.
            Video details and product tags are saved in your Shopify store as app data. Video files are stored and streamed by Cloudflare
            Stream. Settings are kept in our database.
          </li>
          <li>
            <strong>Import links.</strong> If you import a video from a link, we keep that link with the video.
          </li>
          <li>
            <strong>Your plan.</strong> Which plan you&rsquo;re on. Subscriptions are billed by Shopify; we never see payment details.
          </li>
        </ul>

        <h2>Information about your store&rsquo;s visitors</h2>
        <ul>
          <li>
            <strong>Video activity.</strong> When a shopper opens a video, watches it to the end, taps a product or adds one to the cart,
            the app records which video, which of those events happened, and how many seconds were watched. These are counted into daily
            totals per video. They contain no names, email addresses, IP addresses or other identifiers of the shopper.
          </li>
          <li>
            <strong>Sales from videos.</strong> An item added to the cart from a video carries a hidden reference to that video. When sales
            attribution is turned on, we store, for orders containing such items, the order ID and number, the line item, product and
            variant, quantity, amount and currency. We don&rsquo;t store the customer&rsquo;s name, email, address or payment details.
          </li>
          <li>
            <strong>Browser storage.</strong> The app&rsquo;s storefront script keeps a few settings in the shopper&rsquo;s browser: whether a
            video view was already counted in this visit, the sound preference, whether the floating video was closed, and which stories
            were already seen. None of it identifies the shopper, and the app sets no cookies.
          </li>
          <li>
            <strong>Services you connect.</strong> If you connect Google Analytics 4, Google Tag Manager, Meta Pixel, TikTok Pixel,
            Pinterest Tag, Klaviyo or Microsoft Clarity, the app sends video events to those services from the shopper&rsquo;s browser, and
            loads Clarity with your project ID. This only happens after the shopper consents through your store&rsquo;s Shopify cookie
            banner. Those services handle the data under your account and their own policies, so list them in your store&rsquo;s privacy
            policy.
          </li>
        </ul>

        <h2>How we use information</h2>
        <p>
          To run the app: showing your videos and widgets, adding products to the cart, and reporting analytics to you. Also to answer
          support requests and to keep the service secure and working. We don&rsquo;t sell information, use it for advertising, or share one
          store&rsquo;s data with another.
        </p>

        <h2>Service providers</h2>
        <ul>
          <li>Shopify, the platform the app runs on and the billing provider</li>
          <li>Cloudflare, Inc., which stores and streams the videos</li>
          <li>Fly.io, which hosts the app</li>
          <li>Neon, which hosts the app&rsquo;s database</li>
        </ul>
        <p>
          These providers may process data in the United States and other countries where they operate. We share information with anyone
          else only when the law requires it.
        </p>

        <h2>Keeping and deleting data</h2>
        <ul>
          <li>When you uninstall the app, we delete your store&rsquo;s access token straight away.</li>
          <li>
            About 48 hours later, Shopify asks us to erase your store&rsquo;s data, and we delete everything we hold for it: settings,
            analytics, sales attribution and the video files on Cloudflare.
          </li>
          <li>
            When a customer asks your store to see or delete their data, Shopify tells us. For any of their orders credited to a video, we
            report or delete the order references we hold, keeping only the anonymous amounts so your totals stay correct.
          </li>
        </ul>

        <h2>Your rights</h2>
        <p>
          Merchants can ask us for a copy of their data, or to correct or delete it, using the contact details below. Your customers should
          contact your store, which can forward requests to us; Shopify also relays them automatically.
        </p>

        <h2>Security</h2>
        <p>All traffic to and from the app is encrypted in transit, and access to production data is limited to the people who run the app.</p>

        <h2>Changes</h2>
        <p>
          If this policy changes, we&rsquo;ll update the date above, and tell merchants in the app or by email when a change affects them
          materially.
        </p>

        <h2>Contact</h2>
        <address className={styles.contact}>
          {businessName}
          {businessAddress && (
            <>
              <br />
              {businessAddress}
            </>
          )}
          <br />
          {supportEmail ? (
            <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
          ) : (
            <>
              Use the support contact on our <a href={listingUrl}>Shopify App Store listing</a>.
            </>
          )}
        </address>
      </article>
    </main>
  );
}
