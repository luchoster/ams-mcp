'use client';
import { useEffect, useState } from 'react';

// Commented out social icons - will be used later
// import { FaDiscord, FaGithub, FaLinkedin, FaXTwitter } from 'react-icons/fa6';
// import { EXTERNAL_LINKS } from '@/constants/external-links';

import Logo from '@/components/layout/logo';
import { cn } from '@/lib/utils';

const Footer = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    // Get initial theme from localStorage, default to 'light' if none exists
    const savedTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
    setTheme(savedTheme || 'light');

    // Listen for theme changes
    const handleStorageChange = () => {
      const newTheme = localStorage.getItem('theme') as 'light' | 'dark' | null;
      if (newTheme) {
        setTheme(newTheme);
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Listen for direct DOM class changes (for immediate updates)
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setTheme(isDark ? 'dark' : 'light');
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      observer.disconnect();
    };
  }, []);

  // Prevent hydration mismatch by using a consistent theme class until mounted
  // Footer is in light mode when dark theme is applied (inverted behavior)
  const themeClass =
    mounted && theme === 'dark'
      ? 'light bg-foreground text-background [&_*]:border-border/30'
      : 'dark bg-background text-foreground';

  // Logo should be inverted when footer has light background (dark theme)
  // and not inverted when footer has dark background (light theme)
  const logoWordmarkClass = cn(
    // 'w-[min(100%,400px)] ',
    'max-w-[400px]',
    'md:h-32 md:w-full lg:h-80 py-4 opacity-10',
    // 'translate-y-1/4 md:translate-y-1/3 '
    // mounted && theme === 'dark' ? 'invert-0' : 'invert',
  );

  return (
    <footer className={cn('overflow-hidden', themeClass)}>
      <div className="container">
        {/* Social and Status Section - Commented out for now, will be used later */}
        {/* <div className="flex flex-col justify-between border-x border-b md:flex-row">
          <div className="bordered-div-padding flex items-center space-x-3">
            <a
              href={EXTERNAL_LINKS.DISCORD}
              className="px-3 py-2.5 transition-opacity hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Discord"
            >
              <FaDiscord className="size-5" />
            </a>
            <a
              href={EXTERNAL_LINKS.GITHUB}
              className="px-3 py-2.5 transition-opacity hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="GitHub"
            >
              <FaGithub className="size-5" />
            </a>
            <a
              href={EXTERNAL_LINKS.TWITTER}
              className="px-3 py-2.5 transition-opacity hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Twitter"
            >
              <FaXTwitter className="size-5" />
            </a>
            <a
              href={EXTERNAL_LINKS.LINKEDIN}
              className="px-3 py-2.5 transition-opacity hover:opacity-80"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="LinkedIn"
            >
              <FaLinkedin className="size-5" />
            </a>
          </div>
          <div className="bordered-div-padding flex items-center border-t text-[#00A656] md:border-t-0">
            <span
              className={cn(
                'me-3 h-2 w-2 animate-pulse rounded-full bg-[#00A656]',
              )}
            ></span>
            <span className="font-medium">All systems operational</span>
          </div>
        </div> */}

        {/* Status Section - Standalone */}
        <div className="flex justify-center border-x border-t border-b">
          <div className="bordered-div-padding flex items-center text-[#00A656]">
            <span
              className={cn(
                'me-3 h-2 w-2 animate-pulse rounded-full bg-[#00A656]',
              )}
            ></span>
            <span className="font-medium">All systems operational</span>
          </div>
        </div>

        {/* Legal Links Section */}
        <div className="bordered-div-padding text-muted-foreground flex items-center justify-center space-x-6 border-x border-b text-sm">
          <a
            href="/privacy-policy"
            className="hover:text-foreground transition-opacity hover:opacity-80"
          >
            Privacy Policy
          </a>
          <span className="text-border">•</span>
          <a
            href="/terms-of-service"
            className="hover:text-foreground transition-opacity hover:opacity-80"
          >
            Terms of Service
          </a>
        </div>

        {/* Disclaimer Section */}
        <div className="bordered-div-padding text-muted-foreground flex flex-col items-center justify-center border-x border-b text-center text-xs leading-relaxed">
          <p>
            This RAMCO MCP integration is independently developed by{' '}
            <span className="font-medium">Warren Burrows</span>. RAMCO is a registered product of the National Association of Realtors (NAR).
          </p>
          <p className="mt-1">
            This integration is not affiliated with, endorsed by, or officially connected to NAR or RAMCO.
          </p>
        </div>

        {/* Large Logo */}
        <Logo
          className="justify-center border-x"
          iconClassName="hidden"
          wordmarkClassName={logoWordmarkClass}
        />
      </div>
    </footer>
  );
};

export default Footer;
