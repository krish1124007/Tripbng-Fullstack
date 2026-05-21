// LocalStorage service — durable binary writes to disk, with hard
// path-traversal protection. Used by the branding pipeline today;
// designed to be reusable for any future doc / receipt / scan uploads.
//
// Layout:
//   STORAGE_ROOT/
//     branding/AGENCY/<agencyId>/logo-<ts>-<uuid>.<ext>
//     branding/DISTRIBUTOR/<distributorId>/logo-<ts>-<uuid>.<ext>
//
// Every write/read/delete goes through `safeJoin()` which resolves the
// absolute path and rejects anything that escapes STORAGE_ROOT.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import DOMPurify from 'isomorphic-dompurify';
import { AppError } from '@tripbng/shared';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const ROOT = path.resolve(process.cwd(), env.STORAGE_ROOT);

/**
 * Resolve `relPath` against STORAGE_ROOT and assert the result stays
 * inside the root. Throws AppError('VALIDATION_ERROR') on traversal.
 *
 * Tests:
 *   safeJoin('branding/AGENCY/abc/logo.png')           → OK
 *   safeJoin('../etc/passwd')                          → throws
 *   safeJoin('branding/AGENCY/abc/../../../etc/passwd')→ throws
 *   safeJoin('/absolute/abuse')                        → throws
 */
function safeJoin(relPath: string): string {
  if (!relPath || typeof relPath !== 'string') {
    throw new AppError('VALIDATION_ERROR', { reason: 'storage path required' });
  }
  // Absolute paths are never accepted from callers — they must be
  // relative to STORAGE_ROOT. path.resolve will treat absolute paths
  // as anchored to filesystem root, defeating the boundary check.
  if (path.isAbsolute(relPath)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'absolute storage path rejected' });
  }
  const abs = path.resolve(ROOT, relPath);
  const rootWithSep = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;
  // Allow `abs === ROOT` for directory ops; reject anything that
  // doesn't sit inside ROOT.
  if (abs !== ROOT && !abs.startsWith(rootWithSep)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'path traversal blocked' });
  }
  return abs;
}

/**
 * Sniff the byte signature of an image buffer. SVG is detected as a
 * text leading `<?xml`/`<svg` marker and sanitised separately before
 * being persisted — see saveBrandingLogo.
 */
function detectImageExt(buf: Buffer): 'png' | 'jpg' | 'webp' | 'svg' | null {
  if (buf.length < 12) return null;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'png';
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // WebP: RIFF ???? WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return 'webp';
  }
  // SVG — text. We tolerate leading whitespace + optional <?xml ... ?>
  // prolog before the root <svg> element.
  const head = buf.slice(0, 256).toString('utf8').trimStart();
  if (
    head.startsWith('<svg') ||
    (head.startsWith('<?xml') && /<svg[\s>]/i.test(head))
  ) {
    return 'svg';
  }
  return null;
}

/** Target max dimensions for raster logos — fits the header band slot. */
const LOGO_TARGET_W = 400;
const LOGO_TARGET_H = 120;

/**
 * Normalise an SVG: parse via DOMPurify with profile=SVG so any
 * <script>, on* handlers, javascript: URLs, foreignObject, etc. are
 * stripped. The cleaned SVG is what we persist; we never trust the
 * raw upload.
 */
function sanitizeSvg(raw: string): string {
  const cleaned = DOMPurify.sanitize(raw, {
    USE_PROFILES: { svg: true, svgFilters: true },
    // Drop any element/attribute that DOMPurify can't classify as safe.
    FORBID_TAGS: ['script', 'foreignObject', 'iframe'],
    FORBID_ATTR: ['onload', 'onclick', 'onmouseover', 'onerror'],
  });
  if (!cleaned || cleaned.length < 12) {
    throw new AppError('VALIDATION_ERROR', { reason: 'SVG sanitised to empty' });
  }
  return cleaned;
}

export interface SavedBrandingLogo {
  /** Absolute filesystem path — stored on the branding doc internally. */
  absolutePath: string;
  /** Storage-relative path — what callers use to read/delete later. */
  relativePath: string;
  /** Browser-fetchable URL — joined onto the branding doc's publicUrl. */
  publicUrl: string;
  /** Detected extension (png/jpg/webp). */
  ext: string;
  /** Bytes on disk after write. */
  bytes: number;
}

/**
 * Validate, sniff, and persist a branding logo buffer to disk under
 * branding/{subjectKind}/{subjectId}/logo-{ts}-{uuid}.<ext>.
 *
 * Pipeline:
 *   1. Size + signature guard (PNG / JPEG / WebP / SVG only).
 *   2. For raster: sharp().rotate().resize(400, 120, fit: 'inside',
 *      withoutEnlargement: true).toFormat(<original-ext>). `.rotate()`
 *      with no args reads the EXIF orientation and physically rotates
 *      the pixels, then the re-encoded output drops EXIF entirely.
 *   3. For SVG: DOMPurify sanitises out scripts, event handlers,
 *      foreignObject, etc.
 *   4. Final byte cap check after normalisation.
 *
 * Returns the relative + absolute paths plus the /static URL.
 */
export async function saveBrandingLogo(opts: {
  subjectKind: 'AGENCY' | 'DISTRIBUTOR';
  subjectId: string;
  buffer: Buffer;
  maxBytes?: number;
}): Promise<SavedBrandingLogo> {
  const max = opts.maxBytes ?? env.BRANDING_LOGO_MAX_BYTES;
  if (opts.buffer.byteLength > max) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `logo exceeds max size (${max} bytes)`,
    });
  }
  const ext = detectImageExt(opts.buffer);
  if (!ext) {
    throw new AppError('VALIDATION_ERROR', {
      reason: 'unrecognised image bytes (PNG / JPEG / WebP / SVG only)',
    });
  }
  if (!/^[a-fA-F0-9]{24}$/.test(opts.subjectId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid subjectId' });
  }

  let normalised: Buffer;
  let savedExt: string = ext;
  if (ext === 'svg') {
    // SVG sanitiser path — text in, text out, no resize.
    const cleaned = sanitizeSvg(opts.buffer.toString('utf8'));
    normalised = Buffer.from(cleaned, 'utf8');
  } else {
    // Raster path — sharp does:
    //   .rotate()   — bake EXIF orientation into pixels + strip EXIF
    //   .resize()   — letterbox into 400×120 max (no enlargement)
    //   .toFormat() — re-encode with default quality, drops metadata
    const fmt: 'png' | 'jpeg' | 'webp' = ext === 'jpg' ? 'jpeg' : (ext as 'png' | 'webp');
    try {
      normalised = await sharp(opts.buffer)
        .rotate()
        .resize(LOGO_TARGET_W, LOGO_TARGET_H, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .toFormat(fmt)
        .toBuffer();
    } catch (err) {
      throw new AppError('VALIDATION_ERROR', {
        reason: `image normalisation failed: ${(err as Error).message}`,
      });
    }
  }

  // Re-check size after normalisation — a malformed input that
  // expanded under sharp shouldn't slip past the cap.
  if (normalised.byteLength > max) {
    throw new AppError('VALIDATION_ERROR', {
      reason: `normalised logo exceeds max size (${max} bytes)`,
    });
  }

  const filename = `logo-${Date.now()}-${randomUUID()}.${savedExt}`;
  const rel = path.posix.join('branding', opts.subjectKind, opts.subjectId, filename);
  const abs = safeJoin(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, normalised);
  const publicUrl = `/static/${rel.replace(/\\/g, '/')}`;
  logger.info(
    {
      subjectKind: opts.subjectKind,
      subjectId: opts.subjectId,
      bytesIn: opts.buffer.byteLength,
      bytesOut: normalised.byteLength,
      ext: savedExt,
    },
    'branding.logo.saved',
  );
  return {
    absolutePath: abs,
    relativePath: rel,
    publicUrl,
    ext: savedExt,
    bytes: normalised.byteLength,
  };
}

/**
 * Delete a previously-saved file. Silent no-op if missing — used by
 * cleanup paths that don't care whether the file still exists.
 */
export async function deleteFile(relativePath: string): Promise<void> {
  if (!relativePath) return;
  let abs: string;
  try {
    abs = safeJoin(relativePath);
  } catch {
    logger.warn({ relativePath }, 'branding.delete.skipped — traversal blocked');
    return;
  }
  try {
    await fs.unlink(abs);
    logger.info({ relativePath }, 'branding.logo.deleted');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return;
    logger.warn({ relativePath, err: e.message }, 'branding.delete.failed');
  }
}

/** Read the bytes of a previously-saved file. Caller handles ENOENT. */
export async function readFile(relativePath: string): Promise<Buffer> {
  const abs = safeJoin(relativePath);
  return fs.readFile(abs);
}

/** Filesystem root — exposed so callers (e.g. app.ts static serving)
 *  can mount it without duplicating the path-resolution logic. */
export const STORAGE_ROOT_ABS = ROOT;
