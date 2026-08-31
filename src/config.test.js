import { describe, it, expect } from 'vitest';
import { CONFIG } from './config.js';

describe('CONFIG', () => {
    it('should have the correct default values for expected keys', () => {
        expect(CONFIG).toMatchObject({
            REQUEST_EXPIRY_DAYS: 7,
            DAILY_REMINDER_INTERVAL_HOURS: 23.1,
            LANGUAGE: 'ru',
            SPAM_BAN_ATTEMPTS: 5,
            SPAM_WARNING_ATTEMPTS_START: 3,
            MAX_MESSAGE_LENGTH: 2000,
        });
    });

    it('should have correct types for all values', () => {
        expect(typeof CONFIG.REQUEST_EXPIRY_DAYS).toBe('number');
        expect(typeof CONFIG.DAILY_REMINDER_INTERVAL_HOURS).toBe('number');
        expect(typeof CONFIG.LANGUAGE).toBe('string');
        expect(typeof CONFIG.SPAM_BAN_ATTEMPTS).toBe('number');
        expect(typeof CONFIG.SPAM_WARNING_ATTEMPTS_START).toBe('number');
        expect(typeof CONFIG.MAX_MESSAGE_LENGTH).toBe('number');
    });
});
