import { useSearchParams } from "react-router";

// Native <form method="get"> submissions discard the current URL's query
// string — only the form's own fields are sent. Shopify's authenticate.admin()
// requires `shop` and `host` on every full-document request for embedded apps;
// without them it throws and renders a bare App Bridge bootstrap page instead
// of the actual route (this is what showed up as "blank screen" / unresponsive
// navigation on reel and widget detail pages). Spreading the current search
// params as hidden fields restores them on the destination request.
export function PreserveSearchParams() {
  const [searchParams] = useSearchParams();
  return (
    <>
      {Array.from(searchParams.entries()).map(([key, value]) => (
        <input key={key} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}
