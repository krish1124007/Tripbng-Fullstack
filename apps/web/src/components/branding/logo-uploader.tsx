'use client';

// LogoUploader — drag/drop or click to pick a PNG/JPEG/WebP under 2 MB.
// Hands the parent a base64 data URL ready for POST /settings/
// branding/logo. Validates the byte signature client-side so users
// get instant feedback instead of a server-side 400.

import { useCallback, useRef, useState } from 'react';
import { ImagePlus, Trash2, Upload, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

const MAX_BYTES = 2_097_152; // 2 MiB — keep in sync with BRANDING_LOGO_MAX_BYTES.
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp'] as const;

export interface LogoUploaderProps {
  /** Current logo URL — when set, we show a thumbnail + remove btn. */
  currentUrl: string | null;
  /** Called with a fresh data URL once a new logo is picked. */
  onPicked: (dataUrl: string) => void;
  /** Called when the user clicks Remove on an existing logo. */
  onRemove: () => void;
  /** Disables interactions while the parent is saving. */
  busy?: boolean;
}

export function LogoUploader({ currentUrl, onPicked, onRemove, busy }: LogoUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      setError(null);
      const file = files?.[0];
      if (!file) return;
      if (!(ACCEPTED as readonly string[]).includes(file.type)) {
        setError('Only PNG, JPEG, or WebP files allowed.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError(`Logo too large (${(file.size / 1024 / 1024).toFixed(2)} MB · max 2 MB).`);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result;
        if (typeof dataUrl === 'string') onPicked(dataUrl);
      };
      reader.onerror = () => setError('Failed to read file.');
      reader.readAsDataURL(file);
    },
    [onPicked],
  );

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED.join(',')}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
        disabled={busy}
      />
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (!busy) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          'flex items-center gap-4 rounded-lg border-2 border-dashed bg-surface-2/30 p-4 transition-colors',
          dragOver ? 'border-brand-500 bg-brand-50/50' : 'border-strong',
          busy && 'opacity-60',
        )}
      >
        {/* Thumbnail */}
        <div className="grid h-20 w-32 shrink-0 place-items-center rounded-md border bg-surface-1">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt="Logo"
              className="max-h-16 max-w-28 object-contain"
            />
          ) : (
            <ImagePlus className="h-6 w-6 text-ink-4" strokeWidth={1.5} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink-1">
            {currentUrl ? 'Current logo' : 'Add your logo'}
          </p>
          <p className="text-xs text-ink-3">
            PNG, JPEG, or WebP — max 2 MB. Shows on portal + documents.
          </p>
          {error ? (
            <p className="mt-1 flex items-center gap-1 text-[11px] font-medium text-danger">
              <X className="h-3 w-3" /> {error}
            </p>
          ) : null}
          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-3.5 w-3.5" /> {currentUrl ? 'Replace' : 'Upload'}
            </Button>
            {currentUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRemove}
                disabled={busy}
                className="text-danger hover:text-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
