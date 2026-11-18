import { BarChart3, Brain, DollarSign, Users2 } from 'lucide-react';

import { PlusSigns } from '@/components/icons/plus-signs';
import { cn } from '@/lib/utils';
const features = [
  {
    icon: Users2,
    title: (
      <>
        Member Analytics
      </>
    ),
    description: 'Search and analyze with natural language.',
    subDescription:
      'Query your member database using conversational language. Find members, track engagement scores, and identify at-risk members—all through Claude conversations.',
  },
  {
    icon: BarChart3,
    title: 'Health Reports',
    description: 'Comprehensive association insights.',
    subDescription:
      'Generate membership health reports, engagement distribution analysis, and growth metrics. Get actionable insights on membership trends and patterns.',
  },
  {
    icon: DollarSign,
    title: 'Financial Tracking',
    description: 'Monitor payment health in real-time.',
    subDescription:
      'Track outstanding invoices, analyze payment aging, monitor collection rates, and identify delinquency trends across your entire membership base.',
  },
  {
    icon: Brain,
    title: 'Smart Segmentation',
    description: 'AI-powered member insights.',
    subDescription:
      'Automatically segment members by engagement, lifecycle stage, value, or risk factors. Identify patterns and predict churn with ML-style analysis.',
  },
];

export function Features() {
  return (
    <section className="container">
      <div className="grid grid-cols-1 border border-t-0 md:grid-cols-2">
        {features.map((feature, index) => (
          <div
            key={index}
            className={cn(
              'bordered-div-padding relative space-y-8',
              index == 0 && 'border-b md:border-e',
              index == 1 && 'border-b md:border-b-0',
              index == 3 && 'border-t md:border-s',
              feature.className,
            )}
          >
            {index === 0 && (
              // Height is 100% + 2px to account for parent border not being included in the calculation
              <PlusSigns className="absolute inset-0 -mt-0.25 hidden !h-[calc(100%+2px)] -translate-x-full border-y md:block" />
            )}
            <div className="space-y-4 md:space-y-6">
              <div className="space-y-4">
                <h2 className="text-muted-foreground flex items-center gap-2 text-sm leading-snug font-medium md:text-base">
                  <feature.icon className="size-5" />
                  {feature.title}
                </h2>
                <h3 className="text-foreground font-weight-display leading-snug md:text-xl">
                  {feature.description}
                </h3>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed md:text-base">
                {feature.subDescription}
              </p>
            </div>

            {feature.images && (
              <div className="flex flex-col gap-4 mask-b-from-30% mask-b-to-95%">
                {feature.images.map((image, index) => (
                  <img
                    key={index}
                    src={image.src}
                    alt={''}
                    width={image.width}
                    height={image.height}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
