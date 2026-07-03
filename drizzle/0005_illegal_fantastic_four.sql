ALTER TABLE `profiles` ADD `name_key` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_key_unique` ON `profiles` (`name_key`);