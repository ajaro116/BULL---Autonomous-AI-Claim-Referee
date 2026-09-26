import React from 'react';
import { JudgmentResult } from '../types';

interface GaugeProps {
  percentage: number | null;
  leftLabel: string;
  rightLabel: string;
  result: JudgmentResult | null;
  statusText: string;
  isImageMode: boolean;
}

export const Gauge: React.FC<GaugeProps> = ({
  percentage,
  leftLabel,
  rightLabel,
  result,
  statusText,
  isImageMode,
}) => {
  const angle = percentage !== null ? -90 + (percentage / 100) * 180 : -90;
  const isHigh = percentage !== null && percentage >= 50;

  return (
    <div id="gauge-section" className="mt-8 flex flex-col items-center min-h-[40px] text-[#262019]">
      <svg
        width="260"
        height="150"
        viewBox="0 0 300 170"
        className="overflow-visible select-none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="arcGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#3F6B4A" />
            <stop offset="50%" stopColor="#C9A227" />
            <stop offset="100%" stopColor="#9E2B25" />
          </linearGradient>
        </defs>
        <path
          d="M30,150 A120,120 0 0 1 270,150"
          fill="none"
          stroke="url(#arcGradient)"
          strokeWidth="14"
          strokeLinecap="round"
        />
        <circle cx="150" cy="150" r="9" fill="#262019" />
        <line
          x1="150"
          y1="150"
          x2="150"
          y2="42"
          stroke="#262019"
          strokeWidth="4"
          strokeLinecap="round"
          style={{
            transformOrigin: '150px 150px',
            transform: `rotate(${angle}deg)`,
            transition: 'transform 0.65s cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        />
      </svg>

      <div className="flex justify-between w-[260px] -mt-1 text-xs tracking-wider text-[#262019]/60 font-medium">
        <span>{leftLabel}</span>
        <span>{rightLabel}</span>
      </div>

      <div
        id="readout"
        className="font-serif-display font-black text-4xl md:text-5xl text-[#262019] mt-2 tabular-nums h-12 flex items-center justify-center"
      >
        {percentage !== null ? `${percentage}%` : <span>&nbsp;</span>}
      </div>

      {statusText && (
        <div id="status-text" className="text-center text-xs md:text-sm text-[#262019]/60 italic min-h-5 mt-1">
          {statusText}
        </div>
      )}

      {result && (
        <>
          <div
            id="verdict-line"
            className="font-serif-display italic font-medium text-lg md:text-xl text-center mt-1.5 text-[#262019] px-2 min-h-7"
          >
            “{result.verdict}”
          </div>

          <div id="flaw-badge-container" className="mt-2.5">
            <span
              className={`inline-block px-3.5 py-1 rounded-full text-xs font-semibold tracking-wide ${
                isHigh
                  ? 'bg-[#9E2B25]/15 text-[#9E2B25]'
                  : 'bg-[#3F6B4A]/15 text-[#3F6B4A]'
              }`}
            >
              {result.flaw_type}
            </span>
          </div>

          <div
            id="explanation-text"
            className="text-center text-sm md:text-[14.5px] leading-relaxed text-[#262019]/80 mt-3.5 max-w-[420px]"
          >
            {result.explanation}
          </div>

          {!isImageMode && result.targeted_claim && (
            <div
              id="targeted-claim-line"
              className="text-center text-xs text-[#262019]/55 mt-4 pt-3 border-t border-dashed border-[#262019]/15 w-full italic"
            >
              Targeted: "{result.targeted_claim}"
            </div>
          )}
        </>
      )}
    </div>
  );
};
