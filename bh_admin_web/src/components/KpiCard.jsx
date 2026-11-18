import React from 'react';

export default function KpiCard({ title, value, sub, color, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 w-full text-left bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-200 hover:border-[#1E5EFF] transition overflow-hidden"
    >
      <div className="text-xs font-bold text-slate-500 truncate">{title}</div>
      <div className={`text-lg sm:text-xl xl:text-2xl font-black mt-1.5 truncate ${color}`}>
        {value}
      </div>
      <div className="text-xs text-slate-400 mt-1 truncate">{sub}</div>
    </button>
  );
}
