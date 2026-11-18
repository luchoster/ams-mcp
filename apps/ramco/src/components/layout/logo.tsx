import { cn } from '@/lib/utils';

interface LogoProps {
  iconClassName?: string;
  wordmarkClassName?: string;
  className?: string;
  href?: string;
}

export default function Logo({
  iconClassName,
  wordmarkClassName,
  className,
  href = '/',
}: LogoProps) {
  return (
    <a href={href} className={cn('flex items-center gap-2.5', className)}>
      <img
        src="/layout/logo-icon.svg"
        alt="ZeraUS logo"
        width={22}
        height={24}
        className={cn('object-contain', iconClassName)}
      />
      <img
        src="/zeraus-logo.svg"
        alt="ZeraUS"
        width={314}
        height={126}
        className={cn('object-contain', wordmarkClassName)}
      />
    </a>
  );
}
