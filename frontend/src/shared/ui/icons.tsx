import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="size-5 shrink-0"
      {...props}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </Icon>
);

export const CoinsIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
    <path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
  </Icon>
);

export const PieIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z" />
    <path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z" />
  </Icon>
);

export const BarsIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 20v-7M12 20V6M19 20v-10" />
  </Icon>
);

export const TrendIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 17l5.5-5.5 3.5 3.5 7.5-8" />
    <path d="M15 7h5.5v5.5" />
  </Icon>
);

export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M10.27 4.8L10.72 2.49L13.28 2.49L13.73 4.8A7.4 7.4 0 0 1 15.87 5.69L17.82 4.37L19.63 6.18L18.31 8.13A7.4 7.4 0 0 1 19.2 10.27L21.51 10.72L21.51 13.28L19.2 13.73A7.4 7.4 0 0 1 18.31 15.87L19.63 17.82L17.82 19.63L15.87 18.31A7.4 7.4 0 0 1 13.73 19.2L13.28 21.51L10.72 21.51L10.27 19.2A7.4 7.4 0 0 1 8.13 18.31L6.18 19.63L4.37 17.82L5.69 15.87A7.4 7.4 0 0 1 4.8 13.73L2.49 13.28L2.49 10.72L4.8 10.27A7.4 7.4 0 0 1 5.69 8.13L4.37 6.18L6.18 4.37L8.13 5.69A7.4 7.4 0 0 1 10.27 4.8z" />
  </Icon>
);

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 3l18 18" />
    <path d="M10.6 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9M6.6 6.9C4 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

export const SunIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Icon>
);

export const MoonIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
  </Icon>
);

export const LockIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Icon>
);

export const TargetIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" />
  </Icon>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 12h15M13.5 6l6 6-6 6" />
  </Icon>
);

/** Aponta para a direita; gire 90° (rotate-90) para o estado "aberto". */
export const ChevronIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 5.5l6.5 6.5L9 18.5" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

/** Marca: órbitas e segmentos que convergem para o centro. */
export function LogoMark({ className = "size-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth={2} strokeLinecap="round">
        <ellipse cx="24" cy="24" rx="16" ry="7" transform="rotate(-35 24 24)" />
        <ellipse cx="24" cy="24" rx="16" ry="7" transform="rotate(35 24 24)" opacity=".55" />
      </g>
      <circle cx="24" cy="24" r="3" fill="currentColor" />
      <circle cx="37" cy="14.5" r="2.2" fill="currentColor" opacity=".8" />
    </svg>
  );
}
