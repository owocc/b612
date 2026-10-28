ALTER TABLE `conversations` ADD `is_pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `conversations` ADD `is_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `conversations` ADD `hidden_at` integer;--> statement-breakpoint
ALTER TABLE `group_members` ADD `pinned_at` integer;--> statement-breakpoint
ALTER TABLE `group_members` ADD `is_archived` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `group_members` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `group_members` ADD `is_hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `group_members` ADD `hidden_at` integer;