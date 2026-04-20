CREATE TABLE `agent_locks` (
	`agent_name` text PRIMARY KEY NOT NULL,
	`pid` integer NOT NULL,
	`acquired_at` integer NOT NULL,
	`lease_until` integer NOT NULL,
	`holder_hostname` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `briefings` (
	`date` text PRIMARY KEY NOT NULL,
	`generated_at` integer NOT NULL,
	`run_id` text NOT NULL,
	`obsidian_ref` text NOT NULL,
	`rating` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`received_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`raw_content_ref` text NOT NULL,
	`classified_domain` text,
	`classified_type` text,
	`confidence` real,
	`entities_json` text DEFAULT '[]' NOT NULL,
	`action_items_json` text DEFAULT '[]' NOT NULL,
	`decisions_json` text DEFAULT '[]' NOT NULL,
	`dispatched_to_json` text DEFAULT '[]' NOT NULL,
	`model_used` text,
	`status` text DEFAULT 'received' NOT NULL,
	`error_message` text
);
--> statement-breakpoint
CREATE INDEX `captures_content_hash_idx` ON `captures` (`content_hash`);--> statement-breakpoint
CREATE INDEX `captures_received_at_idx` ON `captures` (`received_at`);--> statement-breakpoint
CREATE INDEX `captures_status_idx` ON `captures` (`status`);--> statement-breakpoint
CREATE TABLE `embeddings` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`chunk_idx` integer NOT NULL,
	`content_hash` text NOT NULL,
	`text` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`indexed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `embeddings_source_idx` ON `embeddings` (`source_kind`,`source_ref`);--> statement-breakpoint
CREATE INDEX `embeddings_content_hash_idx` ON `embeddings` (`content_hash`);--> statement-breakpoint
CREATE TABLE `mcp_consents` (
	`id` text PRIMARY KEY NOT NULL,
	`server_name` text NOT NULL,
	`tool_name` text,
	`scope` text NOT NULL,
	`granted_at` integer NOT NULL,
	`expires_at` integer,
	`notes` text
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`slug` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text NOT NULL,
	`notion_page_id` text,
	`linear_team_key` text,
	`todoist_project_id` text,
	`obsidian_folder` text,
	`status` text DEFAULT 'active' NOT NULL,
	`last_activity_at` integer
);
--> statement-breakpoint
CREATE INDEX `projects_domain_idx` ON `projects` (`domain`);--> statement-breakpoint
CREATE INDEX `projects_status_idx` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_name` text NOT NULL,
	`parent_run_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`model_used` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`mcp_servers_json` text DEFAULT '[]' NOT NULL,
	`subagents_json` text DEFAULT '[]' NOT NULL,
	`permission_tier` text DEFAULT 'R0' NOT NULL,
	`reversal_payload` text,
	`reversed_at` integer,
	`error_message` text,
	`output_ref` text
);
--> statement-breakpoint
CREATE INDEX `runs_agent_name_idx` ON `runs` (`agent_name`);--> statement-breakpoint
CREATE INDEX `runs_started_at_idx` ON `runs` (`started_at`);--> statement-breakpoint
CREATE INDEX `runs_status_idx` ON `runs` (`status`);--> statement-breakpoint
CREATE INDEX `runs_parent_idx` ON `runs` (`parent_run_id`);