// Generates the PWA icons: a black-on-yellow lettermark, like a number plate.
//   npm run icons
// Writes public/icons/icon-192.png, icon-512.png, maskable-512.png and app/apple-icon.png.
// The letter is drawn from rectangles so no font has to be installed.
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const HAZARD = "#F5B800";
const INK = "#161C1B";

function lettermark({ maskable }: { maskable: boolean }): string {
  // A condensed F, inside the 80% safe zone so a maskable crop never clips it.
  const shapes = [
    { x: 30, y: 22, w: 14, h: 56 }, // stem
    { x: 30, y: 22, w: 42, h: 13 }, // top bar
    { x: 30, y: 45, w: 33, h: 12 }, // middle bar
  ]
    .map((rect) => `<rect x="${rect.x}" y="${rect.y}" width="${rect.w}" height="${rect.h}" fill="${INK}"/>`)
    .join("");
  const corner = maskable ? 0 : 14;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="${corner}" fill="${HAZARD}"/>${shapes}</svg>`;
}

async function render(svg: string, size: number, file: string) {
  const png = await sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
  await writeFile(file, png);
  console.log(`${file} (${size}×${size}, ${png.length} bytes)`);
}

await mkdir("public/icons", { recursive: true });
const any = lettermark({ maskable: false });
const maskable = lettermark({ maskable: true });
await render(any, 192, "public/icons/icon-192.png");
await render(any, 512, "public/icons/icon-512.png");
await render(maskable, 512, "public/icons/maskable-512.png");
await render(maskable, 180, "app/apple-icon.png");
