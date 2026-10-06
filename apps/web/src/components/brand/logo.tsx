import { useId } from 'react';

/**
 * The Primordial Health mark (D-103): a teal tile with a rounded "P" whose bowl is a leaf, and a coral spark — care
 * that grows. Pure SVG, so it is crisp everywhere; the same drawing is in public/logo.svg, app/icon.svg and the
 * mobile app icon.
 */
export function LogoMark({ className = 'h-9 w-9', title }: { className?: string; title?: string }) {
  const id = useId();
  const tile = `${id}-tile`;
  const spark = `${id}-spark`;
  return (
    <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={tile} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2fc2ae" />
          <stop offset="0.55" stopColor="#0f766e" />
          <stop offset="1" stopColor="#042f2e" />
        </linearGradient>
        <linearGradient id={spark} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fea697" />
          <stop offset="1" stopColor="#ef5a46" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill={`url(#${tile})`} />
      {/* The P: stem and a leaf-shaped bowl. */}
      <path d="M16.5 36V13.5h9a8.25 8.25 0 0 1 0 16.5h-9" fill="none" stroke="#fff" strokeWidth="4.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M21.5 25.2c1.6-3.9 4.4-5.6 8-5.7-.5 3.7-3 6-8 5.7Z" fill="#ccf7ee" />
      {/* The coral spark. */}
      <circle cx="36.5" cy="11.5" r="4" fill={`url(#${spark})`} />
      <circle cx="36.5" cy="11.5" r="6.2" fill="none" stroke="#fea697" strokeOpacity="0.45" strokeWidth="1.2" />
    </svg>
  );
}

/** Mark + name, for headers and the login screen. `tone` = the background it sits on. */
export function Logo({ tone = 'light', tagline = true }: { tone?: 'light' | 'dark'; tagline?: boolean }) {
  return (
    <span className="flex items-center gap-3">
      <LogoMark className="h-10 w-10 drop-shadow-[0_6px_14px_rgb(15_118_110_/_0.35)]" />
      <span className="leading-tight">
        <span className={`block font-display text-[17px] font-extrabold tracking-tight ${tone === 'dark' ? 'text-white' : 'text-ink'}`}>
          Primordial<span className="text-accent-400">.</span>Health
        </span>
        {tagline && <span className={`block text-xs ${tone === 'dark' ? 'text-brand-200' : 'text-brand-700'}`}>Care, beautifully organised</span>}
      </span>
    </span>
  );
}
