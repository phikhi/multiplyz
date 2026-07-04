CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`world_index` integer NOT NULL,
	`species_key` text NOT NULL,
	`name_default` text NOT NULL,
	`rarity` text NOT NULL,
	`max_stage` integer DEFAULT 1 NOT NULL,
	`in_egg_pool` integer DEFAULT true NOT NULL,
	`art_ref` text NOT NULL,
	`art_ref_stages` text,
	`story` text
);
--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`character_id` text NOT NULL,
	`count` integer DEFAULT 1 NOT NULL,
	`stage` integer DEFAULT 1 NOT NULL,
	`nickname` text,
	`unlocked_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
