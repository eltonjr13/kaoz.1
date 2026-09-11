import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const FACE_CROP = { left: 250, top: 90, width: 700, height: 700 };
const CORNER_RATIO = 0.22;

function roundedMask(size) {
  const radius = Math.round(size * CORNER_RATIO);
  return Buffer.from(
    `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="#fff"/></svg>`
  );
}

async function tile(source, size, crop) {
  const base = crop ? sharp(source).extract(crop) : sharp(source);
  const resized = await base.resize(size, size, { fit: "cover" }).png().toBuffer();
  return sharp(resized).composite([{ input: roundedMask(size), blend: "dest-in" }]).png().toBuffer();
}

/**
 * Chrome uses the small sizes in the toolbar and the large ones on
 * chrome://extensions, so the toolbar keeps a face crop (the full illustration
 * turns into a dark smear at 16px) while the large sizes reuse the app art.
 */
export async function ensureExtensionIcons(root = process.cwd()) {
  const source = path.join(root, "app", "icon.png");
  if (!fs.existsSync(source)) throw new Error(`Ícone de origem não encontrado em: ${source}`);
  const iconsDir = path.join(root, "extensions", "flow-companion", "icons");
  const assetsDir = path.join(root, "extensions", "flow-companion", "assets");
  fs.mkdirSync(iconsDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });

  const plan = [
    [16, FACE_CROP],
    [32, FACE_CROP],
    [48, null],
    [128, null],
  ];
  const written = [];
  for (const [size, crop] of plan) {
    const file = path.join(iconsDir, `icon-${size}.png`);
    fs.writeFileSync(file, await tile(source, size, crop));
    written.push(file);
  }
  const mark = path.join(assetsDir, "kaoz-mark.png");
  fs.writeFileSync(mark, await tile(source, 96, null));
  written.push(mark);
  return written;
}

const currentFile = import.meta.url.startsWith("file://")
  ? path.normalize(new URL(import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0))
  : "";
if (process.argv[1] && currentFile && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  ensureExtensionIcons()
    .then((files) => files.forEach((file) => console.log(`Ícone gravado: ${file}`)))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
