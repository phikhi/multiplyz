CREATE TABLE `egg_pity` (
	`profile_id` integer PRIMARY KEY NOT NULL,
	`consecutive_duplicates` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
