CREATE TABLE requests (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	chat_id TEXT NOT NULL,
	user_id INTEGER NOT NULL,
	username TEXT,
	display_name TEXT,
	request_date INTEGER NOT NULL,
	expires_at INTEGER NOT NULL,
	status TEXT NOT NULL DEFAULT 'pending', -- pending, answered, confirmed, rejected, timed_out, user_missing_or_banned, request_no_longer_valid
	answer_text TEXT,
	answer_date INTEGER,
	confirmed_date INTEGER,
	reminder_3_sent INTEGER DEFAULT 0,
	reminder_6_sent INTEGER DEFAULT 0,
	last_reminder_ts INTEGER
  );
  
  CREATE TABLE events (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	request_id INTEGER,
	user_id INTEGER,
	event_type TEXT, -- submitted, answered, confirmed, reminder_sent, auto_rejected, admin_action
	event_ts INTEGER,
	data TEXT
  );