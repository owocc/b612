ALTER TABLE `ai_characters` ADD `friend_permission` text DEFAULT 'feed_and_chat' NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_characters` ADD `hide_my_posts_from_them` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `ai_characters` ADD `hide_their_posts_from_me` integer DEFAULT false NOT NULL;