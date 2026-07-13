ALTER TABLE `household_settings` ADD `sound_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `household_settings` ADD `music_enabled` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `household_settings` ADD `volume` integer DEFAULT 70 NOT NULL;