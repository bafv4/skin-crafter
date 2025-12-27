export function CraftingTableIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
    >
      {/* Background */}
      <rect x="0" y="0" width="32" height="32" className="fill-slate-50 dark:fill-slate-950" />

      {/* Outer border */}
      <rect x="2" y="2" width="28" height="28" className="fill-slate-800 dark:fill-slate-900" />

      {/* Main surface */}
      <rect x="3" y="3" width="26" height="26" className="fill-slate-600 dark:fill-slate-700" />

      {/* 3x3 Grid cells */}
      {/* Row 1 */}
      <rect x="4" y="4" width="7" height="7" className="fill-slate-700 dark:fill-slate-800" />
      <rect x="12" y="4" width="8" height="7" className="fill-slate-500 dark:fill-slate-600" />
      <rect x="21" y="4" width="7" height="7" className="fill-slate-700 dark:fill-slate-800" />

      {/* Row 2 */}
      <rect x="4" y="12" width="7" height="8" className="fill-slate-500 dark:fill-slate-600" />
      <rect x="12" y="12" width="8" height="8" className="fill-slate-700 dark:fill-slate-800" />
      <rect x="21" y="12" width="7" height="8" className="fill-slate-500 dark:fill-slate-600" />

      {/* Row 3 */}
      <rect x="4" y="21" width="7" height="7" className="fill-slate-700 dark:fill-slate-800" />
      <rect x="12" y="21" width="8" height="7" className="fill-slate-500 dark:fill-slate-600" />
      <rect x="21" y="21" width="7" height="7" className="fill-slate-700 dark:fill-slate-800" />

      {/* Grid lines */}
      <rect x="11" y="4" width="1" height="24" className="fill-slate-800 dark:fill-slate-900" />
      <rect x="20" y="4" width="1" height="24" className="fill-slate-800 dark:fill-slate-900" />
      <rect x="4" y="11" width="24" height="1" className="fill-slate-800 dark:fill-slate-900" />
      <rect x="4" y="20" width="24" height="1" className="fill-slate-800 dark:fill-slate-900" />

      {/* Subtle highlights */}
      <rect x="5" y="5" width="3" height="1" className="fill-slate-400 dark:fill-slate-500" opacity="0.4" />
      <rect x="22" y="6" width="2" height="1" className="fill-slate-400 dark:fill-slate-500" opacity="0.4" />
      <rect x="13" y="13" width="4" height="1" className="fill-slate-400 dark:fill-slate-500" opacity="0.4" />
      <rect x="6" y="22" width="2" height="1" className="fill-slate-400 dark:fill-slate-500" opacity="0.4" />
      <rect x="22" y="23" width="3" height="1" className="fill-slate-400 dark:fill-slate-500" opacity="0.4" />
    </svg>
  );
}
