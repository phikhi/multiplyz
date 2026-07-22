CREATE TABLE `cosmetics` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`art_ref` text NOT NULL,
	`price_coins` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `cosmetics_owned` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`cosmetic_id` text NOT NULL,
	`equipped` integer DEFAULT false NOT NULL,
	`acquired_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cosmetic_id`) REFERENCES `cosmetics`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `daily` (
	`profile_id` integer PRIMARY KEY NOT NULL,
	`streak_count` integer DEFAULT 0 NOT NULL,
	`last_claim_date` text,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`item_key` text NOT NULL,
	`qty` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
