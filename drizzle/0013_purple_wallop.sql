CREATE TABLE `household_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`parent_world_validation` integer DEFAULT false NOT NULL,
	`screen_time_nudge_minutes` integer DEFAULT 20 NOT NULL,
	`screen_time_hard_lock_enabled` integer DEFAULT false NOT NULL,
	`screen_time_hard_lock_minutes` integer DEFAULT 45 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
