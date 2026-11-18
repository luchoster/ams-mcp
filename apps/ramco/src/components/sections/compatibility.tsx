'use client';

import { useEffect, useRef, useState } from 'react';

import { Check, Code, Copy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';

// Get pre-highlighted code from global variable set by Astro
declare global {
  interface Window {
    highlightedFrameworks?: Array<{
      name: string;
      code: string;
      lightHtml: string;
      darkHtml: string;
    }>;
  }
}

const frameworks =
  typeof window !== 'undefined' && window.highlightedFrameworks
    ? window.highlightedFrameworks
    : [];

export function Compatibility() {
  const [activeTab, setActiveTab] = useState(
    frameworks[0]?.name || 'Claude Code',
  );
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const { isAtLeast } = useMediaQuery();
  const isMobile = !isAtLeast('md');

  useEffect(() => {
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

  return (
    <section className="container">
      <div className="bordered-div-padding border border-t-0">
        <div className="space-y-4">
          <h3 className="text-muted-foreground flex items-center gap-2 text-sm leading-snug font-medium md:text-base">
            <Code className="size-5" />
            Configuration
          </h3>
          <h2 className="text-foreground font-weight-display leading-snug md:text-xl">
            Setup examples for Claude Code and Claude Desktop:
          </h2>
        </div>

        <div className="mt-6 gap-6">
          {isMobile ? (
            <Select value={activeTab} onValueChange={setActiveTab}>
              <SelectTrigger className="w-full">
                <SelectValue>{activeTab}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {frameworks.map((framework) => (
                  <SelectItem key={framework.name} value={framework.name}>
                    {framework.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="flex gap-3">
                {frameworks.map((framework) => (
                  <TabsTrigger key={framework.name} value={framework.name}>
                    {framework.name}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          <div className="mt-4">
            {frameworks.length === 0 ? (
              <Card className="relative overflow-hidden !p-0">
                <CardContent className="!p-0">
                  <div className="flex h-92 items-center justify-center">
                    <div className="text-muted-foreground">Loading...</div>
                  </div>
                </CardContent>
              </Card>
            ) : (
              frameworks.map(
                (framework) =>
                  framework.name === activeTab && (
                    <Card
                      key={framework.name}
                      className="relative overflow-hidden !p-0"
                    >
                      <CardContent className="!p-0">
                        <div
                          dangerouslySetInnerHTML={{
                            __html:
                              theme === 'dark'
                                ? framework.darkHtml
                                : framework.lightHtml,
                          }}
                          className="h-89 overflow-x-auto overflow-y-auto text-sm [&_pre]:m-0 [&_pre]:h-89 [&_pre]:bg-transparent [&_pre]:p-4 [&_pre]:whitespace-pre-wrap"
                        />
                        <CopyButton
                          text={framework.code}
                          className="absolute top-4 right-4"
                        />
                      </CardContent>
                    </Card>
                  ),
              )
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

interface CopyButtonProps {
  text: string;
  className?: string;
}

function CopyButton({ text, className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>(undefined);

  const handleCopy = async () => {
    if (copied) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);

      clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  return (
    <Button
      aria-label="Copy code"
      onClick={handleCopy}
      variant="ghost"
      size="icon"
      className={cn(className)}
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={copied ? 'check' : 'copy'}
          initial={{ opacity: 0, y: 2 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          transition={{ duration: 0.15 }}
        >
          {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        </motion.div>
      </AnimatePresence>
    </Button>
  );
}
