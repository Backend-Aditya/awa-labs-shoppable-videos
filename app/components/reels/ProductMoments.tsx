// "Product moments" on a reel's Products tab: the second each tagged
// product appears in the video. The storefront viewer pops that product up
// over the video then. Times are scrubbed on a slider that shows the actual
// frame (Stream thumbnails), the way the Cover tab picks a cover.
import { Card } from "../widget-editor/controls";
import editorStyles from "../widget-editor/editor.module.css";
import { formatDuration, isStreamThumbnail, lastMomentSecond, posterAt } from "../../models/reel-media";
import styles from "./moments.module.css";

export interface MomentProduct {
  id: string;
  title: string;
  imageUrl: string | null;
}

export const momentKey = (productId: string) => productId.split("/").pop()!;
const clock = (seconds: number) => formatDuration(seconds) || "0:00";

export function ProductMoments({
  products,
  posterUrl,
  duration,
  times,
  onChange,
}: {
  products: MomentProduct[];
  posterUrl: string | null;
  duration: number;
  times: Record<string, number>;
  onChange: (times: Record<string, number>) => void;
}) {
  const description = "Pop a product up over the video the moment it's on screen — shoppers tap it to shop. Products without a time stay in the list as usual.";
  if (products.length === 0) return null;
  if (duration <= 0) {
    return (
      <Card title="Product moments" description={description}>
        <p className={editorStyles.hint}>You can time products once the video has finished processing.</p>
      </Card>
    );
  }

  const max = lastMomentSecond(duration);
  const frames = isStreamThumbnail(posterUrl);
  const set = (key: string, seconds: number | null) => {
    const next = { ...times };
    if (seconds === null) delete next[key];
    else next[key] = seconds;
    onChange(next);
  };

  return (
    <Card title="Product moments" description={description}>
      <ul className={styles.list}>
        {products.map((product, i) => {
          const key = momentKey(product.id);
          const at = times[key];
          const timed = typeof at === "number";
          const image = timed && frames ? posterAt(posterUrl, at) : product.imageUrl;
          return (
            <li key={product.id} className={styles.row} data-timed={timed || undefined}>
              <span
                className={styles.thumb}
                data-frame={(timed && frames) || undefined}
                style={image ? { backgroundImage: `url("${image}")` } : undefined}
                aria-hidden="true"
              />
              <span className={styles.body}>
                <span className={styles.head}>
                  <span className={styles.title}>{product.title}</span>
                  {timed ? (
                    <button type="button" className={editorStyles.noticeLink} onClick={() => set(key, null)}>
                      Remove time
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={editorStyles.noticeLink}
                      // Start untimed products spread across the video.
                      onClick={() => set(key, Math.min(Math.round((duration * (i + 1)) / (products.length + 1)), max))}
                    >
                      Set a time
                    </button>
                  )}
                </span>
                {timed ? (
                  <span className={styles.slider}>
                    <input
                      type="range"
                      className={editorStyles.range}
                      min={0}
                      max={max}
                      step={1}
                      value={Math.min(at, max)}
                      aria-label={`When ${product.title} pops up`}
                      aria-valuetext={clock(at)}
                      onChange={(e) => set(key, Number(e.currentTarget.value))}
                    />
                    <span className={styles.time}>{clock(at)}</span>
                  </span>
                ) : (
                  <span className={editorStyles.hint}>Not timed</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
