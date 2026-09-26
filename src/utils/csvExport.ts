import { HistoryEntry } from '../types';

/**
 * Escapes a cell value for standard CSV formatting (RFC 4180).
 * Encloses the field in double quotes if it contains commas, double quotes, or newlines.
 */
function escapeCSVCell(val: string | number | boolean | undefined | null): string {
  if (val === undefined || val === null) {
    return '""';
  }
  const str = String(val);
  // If the cell contains quotes, commas, or line breaks, quote it and escape internal quotes
  if (str.includes('"') || str.includes(',') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return `"${str}"`;
}

/**
 * Converts a list of HistoryEntry objects into CSV content.
 */
export function generateHistoryCSV(items: HistoryEntry[], defaultCategory: string = 'Claim'): string {
  const headers = [
    'Session ID',
    'Date / Time',
    'Category',
    'Claim or Asset Evaluated',
    'BULL Percentage',
    'Evaluation',
    'Verdict Headline',
    'Flaw Type',
    'Referee Explanation',
    'Safe Phrasing / Alternative',
  ];

  const rows = items.map((item) => {
    const isImage = item.type === 'image' || defaultCategory.toLowerCase().includes('image');
    const category = isImage ? 'Image / Visual' : 'Claim / Statement';
    const assessment = item.pct >= 50 ? (isImage ? 'AI Generated / Fabricated' : 'BULL / Overclaimed') : (isImage ? 'Authentic / Real' : 'Legit / Accurate');
    const dateTime = item.timestamp
      ? new Date(item.timestamp).toLocaleString()
      : item.date || new Date().toLocaleTimeString();

    return [
      escapeCSVCell(item.id),
      escapeCSVCell(dateTime),
      escapeCSVCell(category),
      escapeCSVCell(item.claim),
      escapeCSVCell(`${item.pct}%`),
      escapeCSVCell(assessment),
      escapeCSVCell(item.verdict || (item.pct >= 50 ? 'Called Out' : 'Verified Legit')),
      escapeCSVCell(item.flawType || 'Standard Review'),
      escapeCSVCell(item.explanation || ''),
      escapeCSVCell(item.safeRewrite || ''),
    ].join(',');
  });

  // Prepend UTF-8 BOM so Excel & Numbers open international characters & symbols seamlessly
  return '\uFEFF' + [headers.map(h => escapeCSVCell(h)).join(','), ...rows].join('\r\n');
}

/**
 * Triggers a client-side download of the CSV content.
 */
export function downloadCSV(csvContent: string, fileName: string): void {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', fileName.endsWith('.csv') ? fileName : `${fileName}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Convenience helper to export a single list of history entries.
 */
export function exportHistoryListToCSV(items: HistoryEntry[], title: string): void {
  if (items.length === 0) return;
  const isImage = title.toLowerCase().includes('image');
  const dateStr = new Date().toISOString().slice(0, 10);
  const prefix = isImage ? 'bull-referee-images' : 'bull-referee-claims';
  const csv = generateHistoryCSV(items, isImage ? 'Image' : 'Claim');
  downloadCSV(csv, `${prefix}-${dateStr}.csv`);
}

/**
 * Convenience helper to export both claim and image history lists combined.
 */
export function exportCombinedHistoryToCSV(claims: HistoryEntry[], images: HistoryEntry[]): void {
  const combined = [
    ...claims.map(c => ({ ...c, type: 'claim' as const })),
    ...images.map(i => ({ ...i, type: 'image' as const })),
  ];
  if (combined.length === 0) return;
  const dateStr = new Date().toISOString().slice(0, 10);
  const csv = generateHistoryCSV(combined, 'Combined Session');
  downloadCSV(csv, `bull-referee-all-history-${dateStr}.csv`);
}
