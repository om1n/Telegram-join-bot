-- Migration number: 0001 	 2025-12-30T19:11:12.000Z
ALTER TABLE requests ADD COLUMN last_reminder_ts INTEGER;
