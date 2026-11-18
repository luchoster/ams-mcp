/**
 * Rate Limiting Utility
 *
 * Implements token bucket algorithm for rate limiting requests
 * Prevents API abuse and ensures fair usage
 */

import { createLogger } from './logger';

const logger = createLogger('rate-limiter');

export interface RateLimitConfig {
  maxTokens: number;        // Maximum tokens in bucket
  refillRate: number;       // Tokens added per second
  keyExtractor?: (request: Request) => string;  // Extract key from request
}

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private buckets: Map<string, TokenBucket>;
  private config: RateLimitConfig;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxTokens: config.maxTokens || 100,
      refillRate: config.refillRate || 10,
      keyExtractor: config.keyExtractor || this.defaultKeyExtractor
    };

    this.buckets = new Map();
    this.cleanupInterval = null;

    // Start cleanup task (remove expired buckets)
    this.startCleanup();
  }

  private defaultKeyExtractor(request: Request): string {
    // Extract API key or IP from request
    const apiKey = request.headers.get('key') ||
                   request.headers.get('authorization') ||
                   request.headers.get('x-ramco-api-key');

    // Fallback to IP if available (not always available in serverless)
    const ip = request.headers.get('x-forwarded-for') ||
               request.headers.get('x-real-ip') ||
               'unknown';

    return apiKey || ip;
  }

  private refillTokens(bucket: TokenBucket): void {
    const now = Date.now();
    const timePassed = (now - bucket.lastRefill) / 1000; // seconds
    const tokensToAdd = timePassed * this.config.refillRate;

    bucket.tokens = Math.min(
      this.config.maxTokens,
      bucket.tokens + tokensToAdd
    );
    bucket.lastRefill = now;
  }

  /**
   * Check if request is allowed and consume a token
   *
   * @param request - HTTP request
   * @param cost - Number of tokens to consume (default 1)
   * @returns true if allowed, false if rate limited
   */
  async checkLimit(request: Request, cost: number = 1): Promise<boolean> {
    const key = this.config.keyExtractor!(request);

    // Get or create bucket
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = {
        tokens: this.config.maxTokens,
        lastRefill: Date.now()
      };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on time passed
    this.refillTokens(bucket);

    // Check if enough tokens available
    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      logger.debug('Rate limit check passed', {
        key: key.substring(0, 8) + '...',
        tokensRemaining: Math.floor(bucket.tokens),
        cost
      });
      return true;
    }

    logger.warn('Rate limit exceeded', {
      key: key.substring(0, 8) + '...',
      tokensRemaining: Math.floor(bucket.tokens),
      cost
    });
    return false;
  }

  /**
   * Get rate limit status for a request
   */
  async getStatus(request: Request): Promise<{
    remaining: number;
    limit: number;
    resetIn: number;
  }> {
    const key = this.config.keyExtractor!(request);
    const bucket = this.buckets.get(key);

    if (!bucket) {
      return {
        remaining: this.config.maxTokens,
        limit: this.config.maxTokens,
        resetIn: 0
      };
    }

    this.refillTokens(bucket);

    const tokensNeeded = this.config.maxTokens - bucket.tokens;
    const resetIn = tokensNeeded / this.config.refillRate;

    return {
      remaining: Math.floor(bucket.tokens),
      limit: this.config.maxTokens,
      resetIn: Math.ceil(resetIn)
    };
  }

  /**
   * Create rate limit response headers
   */
  getRateLimitHeaders(status: {
    remaining: number;
    limit: number;
    resetIn: number;
  }): Record<string, string> {
    return {
      'X-RateLimit-Limit': status.limit.toString(),
      'X-RateLimit-Remaining': status.remaining.toString(),
      'X-RateLimit-Reset': (Date.now() + status.resetIn * 1000).toString(),
      'Retry-After': status.resetIn.toString()
    };
  }

  /**
   * Cleanup old buckets periodically
   */
  private startCleanup(): void {
    // Run cleanup every 5 minutes
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      const maxAge = 10 * 60 * 1000; // 10 minutes

      for (const [key, bucket] of this.buckets.entries()) {
        if (now - bucket.lastRefill > maxAge) {
          this.buckets.delete(key);
        }
      }

      logger.debug('Rate limiter cleanup completed', {
        bucketsRemaining: this.buckets.size
      });
    }, 5 * 60 * 1000);
  }

  /**
   * Stop cleanup task
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Reset rate limit for a specific key
   */
  reset(request: Request): void {
    const key = this.config.keyExtractor!(request);
    this.buckets.delete(key);
    logger.info('Rate limit reset', { key: key.substring(0, 8) + '...' });
  }

  /**
   * Get current statistics
   */
  getStats(): {
    totalBuckets: number;
    averageTokens: number;
  } {
    const buckets = Array.from(this.buckets.values());
    const totalTokens = buckets.reduce((sum, b) => sum + b.tokens, 0);

    return {
      totalBuckets: buckets.length,
      averageTokens: buckets.length > 0 ? totalTokens / buckets.length : 0
    };
  }
}

// Export singleton with configurable rate limiting
// Rate limiting is OPTIONAL - only enabled if RATE_LIMIT_ENABLED=true
// When enabled, uses generous defaults suitable for bulk operations:
// - 1000 burst capacity
// - 100 requests/second sustained
// - Per API key tracking (trusted users won't interfere with each other)
const isRateLimitEnabled = process.env.RATE_LIMIT_ENABLED === 'true';
const maxTokens = parseInt(process.env.RATE_LIMIT_MAX_TOKENS || '1000', 10);
const refillRate = parseInt(process.env.RATE_LIMIT_REFILL_RATE || '100', 10);

export const rateLimiter = isRateLimitEnabled
  ? new RateLimiter({
      maxTokens,
      refillRate
    })
  : null;

logger.debug('Rate limiter initialized', {
  enabled: isRateLimitEnabled,
  maxTokens: isRateLimitEnabled ? maxTokens : 'N/A',
  refillRate: isRateLimitEnabled ? refillRate : 'N/A'
});

/**
 * Middleware function for rate limiting
 * Returns null if request is allowed, or a 429 Response if rate limited
 */
export async function rateLimit(request: Request): Promise<Response | null> {
  // Skip rate limiting if disabled
  if (!rateLimiter) {
    return null;
  }

  const allowed = await rateLimiter.checkLimit(request);

  if (!allowed) {
    const status = await rateLimiter.getStatus(request);
    const headers = rateLimiter.getRateLimitHeaders(status);

    return new Response(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32000,
        message: 'Rate limit exceeded. Please try again later.',
        data: {
          limit: status.limit,
          resetIn: status.resetIn
        }
      }
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    });
  }

  return null; // Allow request to continue
}
