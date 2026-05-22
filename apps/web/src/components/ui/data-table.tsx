'use client';

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from './skeleton';

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  loading?: boolean;
  empty?: ReactNode;
  density?: 'compact' | 'default';
  onRowClick?: (row: TData) => void;
  className?: string;
}

export function DataTable<TData>({
  columns,
  data,
  loading,
  empty,
  density = 'default',
  onRowClick,
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const rowHeight = density === 'compact' ? 'h-10' : 'h-13';
  const rows = table.getRowModel().rows;

  return (
    <div className={cn('overflow-hidden rounded-lg border bg-surface-1', className)}>
      {/* ───── Desktop table (md and up) ───── */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface-2 text-xs uppercase tracking-wider text-ink-3">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sortDir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      className={cn(
                        'px-4 py-2.5 text-left font-medium',
                        canSort && 'cursor-pointer select-none hover:text-ink-1',
                      )}
                      onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="flex items-center gap-1">
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                        {canSort ? (
                          sortDir === 'asc' ? (
                            <ChevronUp className="h-3 w-3" />
                          ) : sortDir === 'desc' ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ArrowUpDown className="h-3 w-3 opacity-40" />
                          )
                        ) : null}
                      </span>
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className={cn('border-b', rowHeight)}>
                  {columns.map((_c, j) => (
                    <td key={j} className="px-4">
                      <Skeleton className="h-4 w-full max-w-[180px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-ink-3">
                  {empty ?? 'No results.'}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b transition-colors hover:bg-surface-2/60',
                    rowHeight,
                    onRowClick && 'cursor-pointer',
                  )}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 align-middle">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ───── Mobile card view (< md) — each row becomes a stacked label/value card */}
      {/* Horizontal scroll on tiny phones is one of the worst UX patterns — this */}
      {/* gives every list page a clean readable layout at 375px without ANY page */}
      {/* having to opt in. */}
      <div className="divide-y md:hidden">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2 p-3">
              {columns.slice(0, 3).map((_c, j) => (
                <div key={j} className="flex items-center justify-between gap-3">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))}
            </div>
          ))
        ) : rows.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-ink-3">
            {empty ?? 'No results.'}
          </div>
        ) : (
          rows.map((row) => (
            <div
              key={row.id}
              className={cn(
                'space-y-1.5 p-3 transition-colors',
                onRowClick && 'cursor-pointer active:bg-surface-2',
              )}
              onClick={onRowClick ? () => onRowClick(row.original) : undefined}
            >
              {row.getVisibleCells().map((cell) => {
                // Cells whose column has no header (e.g. an actions column with
                // header='') render full-width without a label. Everything else
                // gets a `LABEL  value` two-column row.
                const headerDef = cell.column.columnDef.header;
                const label =
                  typeof headerDef === 'string' && headerDef.trim().length > 0
                    ? headerDef
                    : null;
                const rendered = flexRender(cell.column.columnDef.cell, cell.getContext());
                if (!label) {
                  return (
                    <div key={cell.id} className="pt-1">
                      {rendered}
                    </div>
                  );
                }
                return (
                  <div key={cell.id} className="flex items-start justify-between gap-3">
                    <span className="shrink-0 pt-0.5 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                      {label}
                    </span>
                    <span className="min-w-0 text-right text-sm text-ink-1">{rendered}</span>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
