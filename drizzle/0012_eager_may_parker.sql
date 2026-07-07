CREATE TABLE `socle_worlds` (
	`id` text PRIMARY KEY NOT NULL,
	`slot` integer NOT NULL,
	`theme` text NOT NULL,
	`palette` text NOT NULL,
	`asset_refs` text NOT NULL,
	`prompt` text NOT NULL,
	`seed` text NOT NULL
);
