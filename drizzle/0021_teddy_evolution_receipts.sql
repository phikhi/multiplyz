CREATE TABLE `evolution_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`character_id` text NOT NULL,
	`from_stage` integer NOT NULL,
	`offer` text NOT NULL,
	`balance` text NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
