import React from 'react';

interface StampProps {
  show: boolean;
  label: string;
  isHigh: boolean;
}

export const Stamp: React.FC<StampProps> = ({ show, label, isHigh }) => {
  if (!show) return null;

  return (
    <div
      id="stamp-verdict"
      className={`absolute top-4 right-5 font-serif-display font-black text-sm md:text-base tracking-widest px-3 py-1.5 border-[3px] border-double rounded pointer-events-none z-20 animate-stamp ${
        isHigh
          ? 'text-[#9E2B25] border-[#9E2B25]'
          : 'text-[#3F6B4A] border-[#3F6B4A]'
      }`}
      style={{
        transformOrigin: 'center center',
      }}
    >
      {label}
    </div>
  );
};
