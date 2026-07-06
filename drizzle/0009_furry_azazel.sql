CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`world_index` integer NOT NULL,
	`theme` text NOT NULL,
	`palette` text NOT NULL,
	`asset_refs` text NOT NULL,
	`prompt` text NOT NULL,
	`seed` text NOT NULL,
	`status` text DEFAULT 'buffered' NOT NULL,
	`approved_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `worlds_index_unique` ON `worlds` (`world_index`);