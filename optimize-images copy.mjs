
import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const SRC_ASSETS = path.join(__dirname, '.');
const PUBLIC_DIR = path.join(__dirname, '.');

// Configuration
const SIZES = [640, 1024, 1920]; // Widths to generate
const QUALITY_AVIF = 65; // Aggressive but visually lossless often
const QUALITY_WEBP = 75;

// Helper to check if file exists
async function exists(path) {
    try {
        await fs.access(path);
        return true;
    } catch {
        return false;
    }
}

async function processImage(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) return;

    const filename = path.basename(filePath, ext);
    const dir = path.dirname(filePath);

    console.log(`Processing: ${path.relative(ROOT, filePath)}`);

    const image = sharp(filePath);
    const metadata = await image.metadata();
    const originalWidth = metadata.width;

    // 1. Convert to AVIF & WebP (Full Size)
    const fullAvif = path.join(dir, `${filename}.avif`);
    const fullWebp = path.join(dir, `${filename}.webp`);

    if (!await exists(fullAvif)) {
        await image.avif({ quality: QUALITY_AVIF }).toFile(fullAvif);
    }
    if (!await exists(fullWebp)) {
        // If source is webp, just copy? No, re-compress might be bad, but consistent naming helps.
        // If source IS webp, we might skip webp generation or ensures it fits quality. 
        // For simplicity, we generate if likely source is png/jpg.
        if (ext !== '.webp') {
            await image.webp({ quality: QUALITY_WEBP }).toFile(fullWebp);
        }
    }

    // 2. Generate Resized Versions (for content images)
    // We skip resizing for small icons or logos if they are small (e.g. < 300px)
    if (originalWidth > 300) {
        for (const width of SIZES) {
            if (width >= originalWidth) continue; // Don't upscale

            const avifPath = path.join(dir, `${filename}-${width}.avif`);
            const webpPath = path.join(dir, `${filename}-${width}.webp`);
            // Optional: fallback jpg/png resized? User asked for AVIF/WebP. Browsers supporting srcset usually support webp. 
            // But standard practice often includes a resized fallback. We'll stick to AVIF/WebP for modern srcset for now to save space, 
            // keeping original as the fallback src.

            if (!await exists(avifPath)) {
                await image.clone().resize(width).avif({ quality: QUALITY_AVIF }).toFile(avifPath);
            }
            if (!await exists(webpPath)) {
                await image.clone().resize(width).webp({ quality: QUALITY_WEBP }).toFile(webpPath);
            }
        }
    }
}

async function main() {
    const dirs = [SRC_ASSETS, PUBLIC_DIR];

    for (const dir of dirs) {
        try {
            const files = await fs.readdir(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = await fs.stat(filePath);
                if (stat.isFile()) {
                    await processImage(filePath);
                }
            }
        } catch (err) {
            console.error(`Error processing dir ${dir}:`, err);
        }
    }
    console.log('Optimization complete.');
}

main();
