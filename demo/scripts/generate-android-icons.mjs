/**
 * PlanAI Field — Android launcher icon generator
 * Source: D:\planai\field\assets\planai-field-logo.png
 * Output: mobile/resources + mipmap-* via @capacitor/assets
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const FIELD_ROOT = join(__dirname, '..');
const LOGO_SRC = join(FIELD_ROOT, 'assets', 'planai-field-logo.png');
const GREEN = '#1f8f4c';
const MOBILE_ROOT = process.env.PLANAI_MOBILE_ROOT
  || 'C:\\Users\\Lenovo\\Desktop\\planai_field_web\\mobile';
const RES_DIR = join(MOBILE_ROOT, 'resources');

const sharpPath = require.resolve('sharp', { paths: [MOBILE_ROOT] });
const { default: sharp } = await import(pathToFileURL(sharpPath).href);

const SIZE = 1024;
const SAFE = 682; // ~66% adaptive safe zone

async function logoWithTransparentBg() {
  const { data, info } = await sharp(LOGO_SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = data;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];
    if (r < 40 && g < 40 && b < 40) {
      px[i + 3] = 0;
    }
  }

  return sharp(Buffer.from(px), {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png();
}

async function roundedMask(size, radiusRatio = 0.18) {
  const r = Math.round(size * radiusRatio);
  const svg = `<svg width="${size}" height="${size}">
    <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="white"/>
  </svg>`;
  return Buffer.from(svg);
}

async function buildForeground() {
  const logo = await logoWithTransparentBg();
  const meta = await logo.metadata();
  const scale = Math.min(SAFE / meta.width, SAFE / meta.height) * 0.92;
  const w = Math.round(meta.width * scale);
  const h = Math.round(meta.height * scale);
  const left = Math.round((SIZE - w) / 2);
  const top = Math.round((SIZE - h) / 2 - SIZE * 0.06);

  const resized = await logo.resize(w, h).png().toBuffer();

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();
}

async function buildIconOnly(foregroundBuf) {
  const mask = await roundedMask(SIZE);
  const white = await sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: '#ffffff' },
  })
    .png()
    .toBuffer();

  const icon = await sharp(white)
    .composite([{ input: foregroundBuf }])
    .png()
    .toBuffer();

  return sharp(icon)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function buildSplash() {
  const foreground = await buildForeground();
  const iconCard = await buildIconOnly(foreground);

  const textSvg = `<svg width="${SIZE}" height="${SIZE}" xmlns="http://www.w3.org/2000/svg">
    <style>
      .t { fill: ${GREEN}; font-family: 'Segoe UI', Arial, sans-serif; font-weight: 700; }
    </style>
    <text x="512" y="790" class="t" font-size="72" text-anchor="middle">PlanAI</text>
    <text x="512" y="870" class="t" font-size="72" text-anchor="middle">Field</text>
  </svg>`;

  const iconSized = await sharp(iconCard).resize(520, 520).png().toBuffer();
  const textLayer = await sharp(Buffer.from(textSvg)).resize(SIZE, SIZE).png().toBuffer();

  return sharp({
    create: { width: SIZE, height: SIZE, channels: 4, background: '#ffffff' },
  })
    .composite([
      { input: iconSized, top: 110, left: 252 },
      { input: textLayer, top: 0, left: 0 },
    ])
    .png()
    .toBuffer();
}

async function main() {
  await mkdir(RES_DIR, { recursive: true });

  const foreground = await buildForeground();
  const background = await sharp({
    create: { width: SIZE, height: SIZE, channels: 3, background: '#ffffff' },
  }).png().toBuffer();
  const iconOnly = await buildIconOnly(foreground);
  const splash = await buildSplash();

  await writeFile(join(RES_DIR, 'icon-foreground.png'), foreground);
  await writeFile(join(RES_DIR, 'icon-background.png'), background);
  await writeFile(join(RES_DIR, 'icon-only.png'), iconOnly);
  await writeFile(join(RES_DIR, 'splash.png'), splash);
  await writeFile(join(RES_DIR, 'splash-dark.png'), splash);

  console.log('Generated resources in', RES_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
