/**
 * Security Utilities
 *
 * Functions for API key validation, blacklisting, and rotation support
 */

import { createLogger } from './logger';

const logger = createLogger('security');

// ============================================================================
// API Key Validation
// ============================================================================

/**
 * Validate RAMCO API key format
 * RAMCO API keys can be in various formats depending on configuration
 *
 * @param apiKey - API key to validate
 * @returns true if format is valid
 */
export function isValidApiKeyFormat(apiKey: string): boolean {
  if (!apiKey || typeof apiKey !== 'string') {
    return false;
  }

  // Trim whitespace
  apiKey = apiKey.trim();

  // Must have some content
  if (apiKey.length === 0) {
    return false;
  }

  // If strict validation is enabled, enforce GUID format
  if (process.env.STRICT_API_KEY_VALIDATION === 'true') {
    const guidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidPattern.test(apiKey);
  }

  // Otherwise, accept any reasonable API key format:
  // - Minimum 8 characters
  // - Alphanumeric with dashes, underscores, dots
  // - No whitespace or special characters
  if (apiKey.length < 8) {
    return false;
  }

  const reasonablePattern = /^[a-zA-Z0-9\-_.]+$/;
  return reasonablePattern.test(apiKey);
}

/**
 * Sanitize API key for logging (show first 8 chars + ...)
 *
 * @param apiKey - API key to sanitize
 * @returns Sanitized key for safe logging
 */
export function sanitizeApiKey(apiKey: string): string {
  if (!apiKey || apiKey.length < 8) {
    return '***';
  }
  return `${apiKey.substring(0, 8)}...`;
}

// ============================================================================
// API Key Blacklist
// ============================================================================

/**
 * Blacklisted API keys (revoked or compromised)
 * In production, this should be stored in a database or cache
 */
const blacklistedKeys = new Set<string>(
  (process.env.BLACKLISTED_API_KEYS || '').split(',').filter(k => k.trim())
);

/**
 * Check if an API key is blacklisted
 *
 * @param apiKey - API key to check
 * @returns true if blacklisted
 */
export function isApiKeyBlacklisted(apiKey: string): boolean {
  return blacklistedKeys.has(apiKey.trim());
}

/**
 * Add an API key to the blacklist
 * Use this for compromised or revoked keys
 *
 * @param apiKey - API key to blacklist
 * @param reason - Reason for blacklisting (for logging)
 */
export function blacklistApiKey(apiKey: string, reason: string): void {
  blacklistedKeys.add(apiKey.trim());
  logger.warn('API key blacklisted', {
    key: sanitizeApiKey(apiKey),
    reason
  });
}

/**
 * Remove an API key from the blacklist
 *
 * @param apiKey - API key to remove
 */
export function unblacklistApiKey(apiKey: string): void {
  blacklistedKeys.delete(apiKey.trim());
  logger.info('API key removed from blacklist', {
    key: sanitizeApiKey(apiKey)
  });
}

/**
 * Get count of blacklisted keys (for monitoring)
 */
export function getBlacklistSize(): number {
  return blacklistedKeys.size;
}

// ============================================================================
// API Key Rotation
// ============================================================================

/**
 * Rotation mapping for API keys
 * Maps old keys to new keys for graceful rotation
 * In production, store this in a database with expiration
 */
const keyRotationMap = new Map<string, { newKey: string; expiresAt: Date }>();

/**
 * Register a key rotation
 * Allows old key to work while migrating to new key
 *
 * @param oldKey - The old API key
 * @param newKey - The new API key
 * @param gracePeriodDays - Days until old key expires (default 30)
 */
export function registerKeyRotation(
  oldKey: string,
  newKey: string,
  gracePeriodDays: number = 30
): void {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + gracePeriodDays);

  keyRotationMap.set(oldKey.trim(), {
    newKey: newKey.trim(),
    expiresAt
  });

  logger.info('API key rotation registered', {
    oldKey: sanitizeApiKey(oldKey),
    newKey: sanitizeApiKey(newKey),
    expiresAt: expiresAt.toISOString()
  });
}

/**
 * Get the current (rotated) API key
 * If an old key is provided and a rotation exists, returns new key
 * Otherwise returns the provided key
 *
 * @param apiKey - Original API key
 * @returns Current API key (rotated if applicable)
 */
export function getCurrentApiKey(apiKey: string): {
  key: string;
  wasRotated: boolean;
  expiresAt?: Date;
} {
  const rotation = keyRotationMap.get(apiKey.trim());

  if (!rotation) {
    return { key: apiKey, wasRotated: false };
  }

  // Check if rotation has expired
  if (rotation.expiresAt < new Date()) {
    keyRotationMap.delete(apiKey.trim());
    logger.warn('API key rotation expired', {
      oldKey: sanitizeApiKey(apiKey)
    });
    return { key: apiKey, wasRotated: false };
  }

  logger.debug('API key rotated', {
    oldKey: sanitizeApiKey(apiKey),
    newKey: sanitizeApiKey(rotation.newKey),
    expiresAt: rotation.expiresAt.toISOString()
  });

  return {
    key: rotation.newKey,
    wasRotated: true,
    expiresAt: rotation.expiresAt
  };
}

/**
 * Clean up expired rotations (call periodically)
 */
export function cleanupExpiredRotations(): number {
  const now = new Date();
  let removed = 0;

  for (const [oldKey, rotation] of keyRotationMap.entries()) {
    if (rotation.expiresAt < now) {
      keyRotationMap.delete(oldKey);
      removed++;
    }
  }

  if (removed > 0) {
    logger.info('Expired key rotations cleaned up', { count: removed });
  }

  return removed;
}

// ============================================================================
// Comprehensive Validation
// ============================================================================

/**
 * Validate an API key comprehensively
 * Checks format, blacklist, and returns current key if rotated
 *
 * @param apiKey - API key to validate
 * @returns Validation result
 * @throws Error if key is invalid or blacklisted
 */
export function validateApiKey(apiKey: string): {
  isValid: boolean;
  currentKey: string;
  wasRotated: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check format
  if (!isValidApiKeyFormat(apiKey)) {
    if (process.env.STRICT_API_KEY_VALIDATION === 'true') {
      errors.push('Invalid API key format. Expected GUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx');
    } else {
      errors.push('Invalid API key format. Must be at least 8 characters (alphanumeric, dashes, underscores, dots only).');
    }
  }

  // Check blacklist
  if (isApiKeyBlacklisted(apiKey)) {
    errors.push('API key has been revoked. Please contact support for a new key.');
    logger.warn('Blocked request with blacklisted API key', {
      key: sanitizeApiKey(apiKey)
    });
  }

  // Check rotation
  const { key: currentKey, wasRotated, expiresAt } = getCurrentApiKey(apiKey);

  if (wasRotated) {
    warnings.push(
      `Your API key is being rotated. Please update to the new key before ${expiresAt?.toISOString()}`
    );
  }

  return {
    isValid: errors.length === 0,
    currentKey: currentKey,
    wasRotated,
    errors,
    warnings
  };
}

// ============================================================================
// Cleanup Task
// ============================================================================

// Run cleanup every hour
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    cleanupExpiredRotations();
  }, 60 * 60 * 1000); // 1 hour
}

logger.debug('Security utilities initialized', {
  blacklistedKeys: getBlacklistSize()
});
