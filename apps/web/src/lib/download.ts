'use client';

import { ApiCallError } from './api';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

// Fetches an authenticated binary endpoint and triggers a browser download.
// Necessary because <a href> can't carry an Authorization header — we have to do the
// fetch ourselves, build a blob URL, and click a hidden anchor.
export async function downloadAuthenticatedFile(
  path: string,
  filename: string,
  accessToken: string | null,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
  });
  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = 'Download failed';
    try {
      const json = (await res.json()) as { error?: { code: string; message: string } };
      if (json.error) {
        code = json.error.code;
        message = json.error.message;
      }
    } catch {
      // body wasn't JSON — keep generic message
    }
    throw new ApiCallError(code, message, undefined, res.status);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
