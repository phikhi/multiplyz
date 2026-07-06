CREATE TABLE `teddy_reference_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`expression` text,
	`asset_ref` text NOT NULL,
	`background_strategy` text NOT NULL,
	`transparent` integer NOT NULL,
	`source_photos_hash` text NOT NULL,
	`status` text DEFAULT 'candidate' NOT NULL,
	`approved_by` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
