import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export async function ensureDesktopIcon(root = process.cwd()) {
  const pngPath = path.join(root, "build", "icon.png");
  const icoPath = path.join(root, "build", "icon.ico");

  if (!fs.existsSync(pngPath)) {
    throw new Error(`Ícone PNG de origem não encontrado em: ${pngPath}`);
  }

  const sizes = [16, 32, 48, 64, 128, 256];
  const pngBuffers = await Promise.all(
    sizes.map((size) =>
      sharp(pngPath)
        .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer()
    )
  );

  let headerLen = 6 + sizes.length * 16;
  let offset = headerLen;
  const entries = [];
  const bodyBuffers = [];

  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const buf = pngBuffers[i];
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0);
    dir.writeUInt8(size >= 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(buf.length, 8);
    dir.writeUInt32LE(offset, 12);
    entries.push(dir);
    bodyBuffers.push(buf);
    offset += buf.length;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const icoBuf = Buffer.concat([header, ...entries, ...bodyBuffers]);
  fs.writeFileSync(icoPath, icoBuf);
  console.log(`Ícone ICO garantido em ${icoPath} (${icoBuf.length} bytes)`);
  return icoPath;
}

const currentFile = import.meta.url.startsWith("file://") ? path.normalize(new URL(import.meta.url).pathname.slice(process.platform === "win32" ? 1 : 0)) : "";
if (process.argv[1] && currentFile && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  ensureDesktopIcon().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
