CREATE TABLE `attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`fact_id` text NOT NULL,
	`skill` text NOT NULL,
	`correct` integer NOT NULL,
	`response_ms` integer NOT NULL,
	`is_retry` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mastery` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`fact_id` text NOT NULL,
	`skill` text NOT NULL,
	`strength` integer DEFAULT 0 NOT NULL,
	`correct_count` integer DEFAULT 0 NOT NULL,
	`wrong_count` integer DEFAULT 0 NOT NULL,
	`avg_response_ms` integer DEFAULT 0 NOT NULL,
	`last_seen` integer,
	`next_due` integer,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
