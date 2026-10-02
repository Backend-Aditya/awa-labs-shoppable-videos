import type { ProductSummary } from "../models/reel.server";

export function formatPriceRange(range: ProductSummary["priceRange"]): string | null {
  if (!range) return null;
  const fmt = new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: range.currencyCode,
  });
  const min = fmt.format(Number(range.min));
  return range.min === range.max ? min : `${min} – ${fmt.format(Number(range.max))}`;
}

// A thumbnail + title + price row, used anywhere a reel's tagged products
// are listed, instead of a bare text badge or paragraph per product.
export function TaggedProductRow({ product }: { product: ProductSummary }) {
  const price = formatPriceRange(product.priceRange);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--p-space-base, 12px)" }}>
      <div style={{ width: "32px", height: "32px", flexShrink: 0 }}>
        {product.imageUrl ? (
          <s-image
            src={product.imageUrl}
            alt={product.title}
            aspectRatio="1/1"
            objectFit="cover"
            inlineSize="fill"
            borderRadius="small-100"
          ></s-image>
        ) : (
          <div
            style={{
              width: "100%",
              height: "100%",
              borderRadius: "4px",
              background: "var(--p-color-bg-surface-strong, #d9d9d9)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <s-icon type="bag" tone="neutral"></s-icon>
          </div>
        )}
      </div>
      <div style={{ flexGrow: 1, minWidth: 0 }}>
        <s-text>{product.title}</s-text>
      </div>
      {price && <s-text color="subdued">{price}</s-text>}
    </div>
  );
}
