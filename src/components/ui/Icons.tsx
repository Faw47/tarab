import type React from 'react';

/**
 * Custom High-Quality SVG Icons for Tarab
 * These are hand-crafted to provide a "premium" music-centric look
 * that goes beyond basic wireframe sets.
 */

interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
}

export const AlbumIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Sleeve */}
    <rect x="2" y="3" width="15" height="18" rx="2" />
    {/* Vinyl peeking out */}
    <path d="M17 6c2.8 0 5 2.7 5 6s-2.2 6-5 6" />
    {/* Center label circle on sleeve */}
    <circle cx="9.5" cy="12" r="1.5" />
    {/* Subtle glint on the sleeve corner */}
    <path d="M6 3v2M2 7h2" opacity="0.4" strokeWidth="1.5" />
  </svg>
);

export const LibraryIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* The shelf container */}
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z" />
    {/* Vertical record spines */}
    <path d="M7 3v18M11 3l1 18M15 3v18M19 3v18" opacity="0.6" strokeWidth="1.5" />
    {/* A horizontal label strip */}
    <path d="M7 14h14" opacity="0.4" strokeWidth="1.5" />
  </svg>
);

export const VinylIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <circle cx="12" cy="12" r="10" />
    {/* Grooves */}
    <circle cx="12" cy="12" r="7.5" opacity="0.4" strokeDasharray="1 3" />
    <circle cx="12" cy="12" r="5" opacity="0.2" />
    {/* Center label */}
    <circle cx="12" cy="12" r="2.5" />
    <circle cx="12" cy="12" r="0.5" fill="currentColor" />
  </svg>
);

export const TrackIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Stylized double note */}
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" />
    <circle cx="18" cy="16" r="3" />
    <path d="M9 10l12-2" opacity="0.5" />
  </svg>
);

export const QueueIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M3 6h18M3 12h18M3 18h12" />
    {/* Play arrow at the end of the queue */}
    <path d="M18 15l3 3-3 3" opacity="0.8" />
  </svg>
);

export const TagIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  </svg>
);

export const ArtistIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Stylized person/artist */}
    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
    {/* Subtle spotlight glint */}
    <path d="M12 3v1" opacity="0.4" strokeWidth="1.5" />
  </svg>
);

export const PlaylistIcon = ({ size = 20, className, ...props }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    <path d="M12 11h9" />
    <path d="M12 6h9" />
    <path d="M12 16h9" />
    {/* A record shape as part of the list */}
    <rect x="3" y="5" width="6" height="14" rx="1" opacity="0.4" />
    <path d="M3 13h6" />
    <circle cx="6" cy="11" r="1.5" />
  </svg>
);
