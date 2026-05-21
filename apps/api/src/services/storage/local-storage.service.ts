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

/** Sniff the byte signature of an image buffer. SVG is deliberately
 *  not in this list — see brand schema for the reason. */
function detectImageExt(buf: Buffer): 'png' | 'jpg' | 'webp' | null {
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
  return null;
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
 * Returns the relative + absolute paths plus the /static URL. The
 * caller stores `relativePath` + `publicUrl` on the branding doc;
 * the absolute path is only used for cleanup.
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
      reason: 'unrecognised image bytes (PNG / JPEG / WebP only)',
    });
  }
  // subjectId is an ObjectId hex — purely alphanumeric, so we can
  // safely interpolate. Guard anyway: only [a-f0-9]{24}.
  if (!/^[a-fA-F0-9]{24}$/.test(opts.subjectId)) {
    throw new AppError('VALIDATION_ERROR', { reason: 'invalid subjectId' });
  }
  const filename = `logo-${Date.now()}-${randomUUID()}.${ext}`;
  const rel = path.posix.join('branding', opts.subjectKind, opts.subjectId, filename);
  const abs = safeJoin(rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, opts.buffer);
  // Public URL uses forward slashes regardless of OS path separator.
  const publicUrl = `/static/${rel.replace(/\\/g, '/')}`;
  logger.info(
    {
      subjectKind: opts.subjectKind,
      subjectId: opts.subjectId,
      bytes: opts.buffer.byteLength,
      ext,
    },
    'branding.logo.saved',
  );
  return {
    absolutePath: abs,
    relativePath: rel,
    publicUrl,
    ext,
    bytes: opts.buffer.byteLength,
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
