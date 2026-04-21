CREATE TABLE `prompts` (
	`id` text PRIMARY KEY NOT NULL,
	`version` integer NOT NULL DEFAULT 1,
	`source_sha` text,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`sensitivity` text NOT NULL DEFAULT 'low',
	`complexity` text NOT NULL DEFAULT 'standard',
	`inputs_schema` text,
	`output_config` text NOT NULL DEFAULT '{}',
	`tags` text NOT NULL DEFAULT '[]',
	`synced_at` integer NOT NULL,
	`enabled` integer NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE `prompt_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`repo` text NOT NULL,
	`prompt_id` text NOT NULL REFERENCES `prompts`(`id`) ON DELETE CASCADE,
	`trigger` text NOT NULL,
	`when_expr` text,
	`branch` text NOT NULL DEFAULT 'main',
	`sensitivity_override` text,
	`args` text NOT NULL DEFAULT '{}',
	`enabled` integer NOT NULL DEFAULT 1,
	`source_sha` text,
	`synced_at` integer NOT NULL,
	`last_run_id` text,
	`last_run_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `prompt_targets_repo_prompt_trigger_idx` ON `prompt_targets` (`repo`, `prompt_id`, `trigger`);
--> statement-breakpoint
CREATE INDEX `prompt_targets_trigger_idx` ON `prompt_targets` (`trigger`);
--> statement-breakpoint
CREATE INDEX `prompt_targets_repo_idx` ON `prompt_targets` (`repo`);
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `prompt_id` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `prompt_version` integer;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `target_repo` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD COLUMN `run_trigger` text;
