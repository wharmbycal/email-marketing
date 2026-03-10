import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '../public');

const ONE_KB = 1024;
const DEFAULT_TARGET_KB = 1024; // 1MB default target
let TARGET_BYTES = DEFAULT_TARGET_KB * ONE_KB;

function shouldConvert(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.png' || ext === '.jpg' || ext === '.jpeg';
}

function parseArgs(argv) {
  const args = [...argv];
  let targetKb = DEFAULT_TARGET_KB;
  const files = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--target-kb') {
      const v = Number(args[i + 1]);
      if (!Number.isFinite(v) || v <= 0) throw new Error('Invalid value for --target-kb');
      targetKb = v;
      i++;
      continue;
    }
    if (a.startsWith('--target-kb=')) {
      const v = Number(a.split('=')[1]);
      if (!Number.isFinite(v) || v <= 0) throw new Error('Invalid value for --target-kb');
      targetKb = v;
      continue;
    }
    files.push(a);
  }

  return { targetBytes: Math.round(targetKb * ONE_KB), files };
}

async function convertAndCompressToWebp(inputPath, outPath, targetBytes) {
  // Try a few quality levels to get under target size
  // We bias toward higher visual quality. For PNG sources (often UI/graphics/text),
  // `nearLossless` typically preserves edges/details better at similar sizes.
  const qualitySteps = [92, 90, 88, 86, 84, 82, 80, 78, 76, 74, 72, 70, 68, 66, 64, 62, 60];
  const isPng = path.extname(inputPath).toLowerCase() === '.png';
  for (const quality of qualitySteps) {
    await sharp(inputPath)
      .webp({
        quality,
        effort: 6,
        ...(isPng ? { nearLossless: true } : {}),
      })
      .toFile(outPath);
    const stat = await fs.stat(outPath);
    if (stat.size <= targetBytes) return { quality, size: stat.size };
  }
  const stat = await fs.stat(outPath);
  return { quality: qualitySteps[qualitySteps.length - 1], size: stat.size };
}

async function convertAndCompressToAvif(inputPath, outPath, targetBytes) {
  // AVIF generally compresses better than WebP, so we can start with slightly lower quality settings if needed
  // or expect smaller sizes at same quality.
  const qualitySteps = [80, 75, 70, 65, 60, 55, 50];
  for (const quality of qualitySteps) {
    await sharp(inputPath)
      .avif({
        quality,
        effort: 6, // Higher effort for better compression
      })
      .toFile(outPath);
    const stat = await fs.stat(outPath);
    if (stat.size <= targetBytes) return { quality, size: stat.size };
  }
  const stat = await fs.stat(outPath);
  return { quality: qualitySteps[qualitySteps.length - 1], size: stat.size };
}

async function processFile(filePath) {
  if (!shouldConvert(filePath)) return null;
  const webpPath = filePath.replace(/\.(png|jpg|jpeg)$/i, '.webp');
  const avifPath = filePath.replace(/\.(png|jpg|jpeg)$/i, '.avif');

  const webpResult = await convertAndCompressToWebp(filePath, webpPath, TARGET_BYTES);
  const avifResult = await convertAndCompressToAvif(filePath, avifPath, TARGET_BYTES);

  await fs.unlink(filePath).catch(() => { });
  return { filePath, webpPath, webpResult, avifPath, avifResult };
}

async function main() {
  // If specific files are provided, only process those
  const { targetBytes, files } = parseArgs(process.argv.slice(2));
  TARGET_BYTES = targetBytes;

  const targets = files.length
    ? files.map((p) => path.isAbsolute(p) ? p : path.resolve(publicDir, p))
    : [
      path.resolve(publicDir, 'hh.png'),
      path.resolve(publicDir, 'rfws.png'),
      path.resolve(publicDir, 'skew.png'),
    ];

  const existing = await Promise.all(
    targets.map(async (p) => ({ p, exists: await fs.access(p).then(() => true).catch(() => false) }))
  );
  const toProcess = existing.filter((e) => e.exists).map((e) => e.p);

  const results = [];
  await Promise.all(
    toProcess.map(async (file) => {
      const res = await processFile(file);
      if (res) results.push(res);
    })
  );
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


