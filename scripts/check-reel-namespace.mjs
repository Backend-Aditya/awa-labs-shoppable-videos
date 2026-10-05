// The app's numeric client ID (the "app--<id>" metafield namespace every
// block and snippet needs — see snippets/reel-namespace.liquid for why it's
// a hardcoded literal in each file rather than rendered from one shared
// snippet) has no other source of truth anywhere in this repo: it isn't
// derivable from shopify.app.toml's client_id (a different identifier) or
// from anything else checked in. That means there's nothing external to
// validate the 7 duplicated copies against.
//
// What a build step CAN catch is the realistic failure mode: a future edit
// touches the namespace in one file (e.g. after recreating the app under a
// new client) and misses the others, silently breaking every block that
// wasn't updated. This fails the build if the 7 copies ever disagree with
// each other, even though it can't tell you which value is actually
// correct.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.join(root, "..", "extensions", "shoppable-video-widgets");

const NAMESPACE_PATTERN = /\{%-?\s*assign\s+reel_namespace\s*=\s*'([^']+)'\s*-?%\}/;

function findLiquidFiles(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".liquid"))
    .map((entry) => path.join(dir, entry.name));
}

const files = [
  ...findLiquidFiles(path.join(extensionDir, "blocks")),
  ...findLiquidFiles(path.join(extensionDir, "snippets")),
];

const found = [];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  const match = content.match(NAMESPACE_PATTERN);
  if (match) {
    found.push({ file: path.relative(root, file), namespace: match[1] });
  }
}

if (found.length === 0) {
  console.error("check-reel-namespace: found no files declaring reel_namespace — did they all move or get renamed?");
  process.exit(1);
}

const distinctValues = new Set(found.map((f) => f.namespace));
if (distinctValues.size > 1) {
  console.error("check-reel-namespace: the reel_namespace literal is out of sync across files:\n");
  for (const { file, namespace } of found) {
    console.error(`  ${namespace}  ${file}`);
  }
  console.error(
    "\nEvery copy must be identical (there's no single source of truth to generate them from — " +
      "see this script's header comment). Pick the correct value and update every file that disagrees with it.",
  );
  process.exit(1);
}

console.log(`check-reel-namespace: ${found.length} files agree on "${[...distinctValues][0]}"`);
