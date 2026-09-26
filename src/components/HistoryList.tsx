import React from 'react';
import { HistoryEntry } from '../types';
import { exportHistoryListToCSV } from '../utils/csvExport';

interface HistoryListProps {
  title: string;
  items: HistoryEntry[];
  totalUnfilteredCount?: number;
  searchQuery?: string;
  onClear?: () => void;
}

function highlightMatch(text: string, query?: string): React.ReactNode {
  if (!query || !query.trim()) return text;
  const q = query.trim();
  const lowerText = text.toLowerCase();
  const lowerQ = q.toLowerCase();
  const idx = lowerText.indexOf(lowerQ);
  if (idx === -1) return text;

  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);

  return (
    <>
      {before}
      <mark className="bg-[#C9A227]/40 text-[#F1E9D2] px-0.5 rounded-xs font-medium">
        {match}
      </mark>
      {highlightMatch(after, query)}
    </>
  );
}

export const HistoryList: React.FC<HistoryListProps> = ({
  title,
  items,
  totalUnfilteredCount,
  searchQuery,
  onClear,
}) => {
  if (items.length === 0 && (!searchQuery || !searchQuery.trim())) return null;

  const handleExportCSV = () => {
    exportHistoryListToCSV(items, title);
  };

  const isFiltered = Boolean(searchQuery && searchQuery.trim());
  const displayCount = items.length;

  return (
    <div className="mt-6 w-full bg-[#14213D]/20 border border-[#F1E9D2]/10 rounded-xl p-3.5 backdrop-blur-xs">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="flex items-center gap-2">
          <h2 className="font-sans-body text-xs tracking-wider text-[#F1E9D2]/70 uppercase font-semibold">
            {title}
          </h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#F1E9D2]/10 text-[#F1E9D2]/60 font-mono">
            {displayCount}
            {totalUnfilteredCount !== undefined && totalUnfilteredCount !== displayCount && (
              <span className="opacity-60"> of {totalUnfilteredCount}</span>
            )}
          </span>
          {isFiltered && (
            <span className="text-[10px] text-[#C9A227] italic font-sans-body">
              filtered
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {items.length > 0 && (
            <button
              type="button"
              onClick={handleExportCSV}
              className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#C9A227] hover:text-[#e5ba34] transition-all cursor-pointer px-2.5 py-1 rounded-md bg-[#C9A227]/10 hover:bg-[#C9A227]/20 border border-[#C9A227]/30 shadow-2xs"
              title={`Export ${items.length} ${title} to CSV`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>Export CSV</span>
            </button>
          )}
          {onClear && items.length > 0 && !isFiltered && (
            <button
              type="button"
              onClick={onClear}
              className="text-[11px] text-[#F1E9D2]/40 hover:text-[#E8827D] transition-colors cursor-pointer px-1 py-0.5"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="py-4 text-center text-xs text-[#F1E9D2]/40 border-t border-dashed border-[#F1E9D2]/10">
          No {title.toLowerCase()} match &ldquo;{searchQuery}&rdquo;
        </div>
      ) : (
        <div className="space-y-0.5">
          {items.slice(0, 15).map((entry) => (
            <div
              key={entry.id}
              className="flex items-baseline gap-2.5 py-2 px-1 border-t border-dashed border-[#F1E9D2]/15 text-[#E6DCBE] text-[13.5px] hover:bg-[#F1E9D2]/5 rounded-sm transition-colors"
            >
              <span
                className={`font-serif-display font-bold text-[15px] min-w-[42px] flex-shrink-0 tabular-nums ${
                  entry.isHigh ? 'text-[#E8827D]' : 'text-[#8FCBA0]'
                }`}
              >
                {entry.pct}%
              </span>
              <span
                className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap opacity-90"
                title={entry.claim}
              >
                {highlightMatch(entry.claim, searchQuery)}
              </span>
              {entry.verdict && (
                <span className="hidden sm:inline text-[11px] text-[#F1E9D2]/50 truncate max-w-[140px]">
                  {highlightMatch(entry.verdict, searchQuery)}
                </span>
              )}
              <span className="text-[10.5px] text-[#F1E9D2]/35 tabular-nums shrink-0">
                {entry.date}
              </span>
            </div>
          ))}
        </div>
      )}
      {items.length > 15 && (
        <div className="mt-2 pt-1.5 border-t border-[#F1E9D2]/10 text-center">
          <span className="text-[11px] text-[#F1E9D2]/40">
            Showing latest 15 of {items.length} records. All records included in CSV export.
          </span>
        </div>
      )}
    </div>
  );
};

