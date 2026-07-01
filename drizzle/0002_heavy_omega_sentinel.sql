CREATE TABLE `pin_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`failures` integer DEFAULT 0 NOT NULL,
	`last_failure_at` integer NOT NULL
);
