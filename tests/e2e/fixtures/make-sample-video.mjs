// Regenerates tests/e2e/fixtures/sample.webm (a 3 s, 90×160 colour-cycling
// clip) with Playwright's Chromium — no ffmpeg needed.
//   node tests/e2e/fixtures/make-sample-video.mjs
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("./sample.webm", import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
const base64 = await page.evaluate(async () => {
  const canvas = document.createElement("canvas");
  canvas.width = 90;
  canvas.height = 160;
  const ctx = canvas.getContext("2d");
  const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 60_000 });
  const chunks = [];
  recorder.ondataavailable = (event) => chunks.push(event.data);
  let frame = 0;
  const timer = setInterval(() => {
    ctx.fillStyle = `hsl(${(frame++ * 12) % 360} 50% 55%)`;
    ctx.fillRect(0, 0, 90, 160);
  }, 66);
  recorder.start();
  await new Promise((resolve) => setTimeout(resolve, 3000));
  const stopped = new Promise((resolve) => (recorder.onstop = resolve));
  recorder.stop();
  clearInterval(timer);
  await stopped;
  const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
});
writeFileSync(out, Buffer.from(base64, "base64"));
await browser.close();
console.log(`wrote ${out}`);
