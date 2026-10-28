CREATE TABLE `character_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`character_id` text NOT NULL,
	`type` text DEFAULT 'custom' NOT NULL,
	`url` text NOT NULL,
	`blob_pathname` text,
	`mime_type` text DEFAULT 'image/jpeg' NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`width` integer,
	`height` integer,
	`is_enabled` integer DEFAULT true NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`metadata` text,
	`source` text DEFAULT 'upload' NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsec') * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `ai_characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_assets_character_idx` ON `character_assets` (`character_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `character_assets_user_idx` ON `character_assets` (`user_id`);--> statement-breakpoint
CREATE INDEX `character_assets_character_type_idx` ON `character_assets` (`character_id`,`type`);--> statement-breakpoint
CREATE INDEX `character_assets_enabled_idx` ON `character_assets` (`character_id`,`is_enabled`);