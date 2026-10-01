CREATE TABLE `egg_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` integer NOT NULL,
	`draw_id` text NOT NULL,
	`result` text NOT NULL,
	`acknowledged` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
