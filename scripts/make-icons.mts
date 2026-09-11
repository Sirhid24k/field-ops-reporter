// Generates the PWA icons: a black-on-yellow lettermark, like a number plate.
//   npm run icons
// Writes public/icons/icon-192.png, icon-512.png, maskable-512.png and app/apple-icon.png.
// The letter is drawn from rectangles so no font has to be installed.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";
import { lettermarkSvg } from "../lib/lettermark";

const HAZARD = "#F5B800";
const INK = "#161C1B";

/** The shared lettermark (lib/lettermark.ts, also the route-loading mark) on the hazard square. */
function lettermark({ maskable }: { maskable: boolean }): string {
  return lettermarkSvg({ background: HAZARD, ink: INK, corner: maskable ? 0 : 14 });
}

async function render(svg: string, size: number, file: string) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(file, png);
  console.log(`${file} (${size}×${size}, ${png.length} bytes)`);
}

/** An .ico container holding PNG images (every current browser reads PNG-in-ICO). */
function ico(images: Array<{ size: number; png: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries: Buffer[] = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

async function renderFavicon(svg: string, file: string) {
  const sizes = [16, 32, 48];
  const images = await Promise.all(sizes.map(async (size) => ({ size, png: await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer() })));
  const bytes = ico(images);
  await writeFile(file, bytes);
  console.log(`${file} (${sizes.join("/")}, ${bytes.length} bytes)`);
}

await mkdir("public/icons", { recursive: true });
const any = lettermark({ maskable: false });
const maskable = lettermark({ maskable: true });
await render(any, 192, "public/icons/icon-192.png");
await render(any, 512, "public/icons/icon-512.png");
await render(maskable, 512, "public/icons/maskable-512.png");
await render(maskable, 180, "app/apple-icon.png");
await renderFavicon(any, "app/favicon.ico");
