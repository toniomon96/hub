-- Phase 8: signal loop — captures acted/ignored/wrong feedback per run
CREATE TABLE `feedback` (
  `id` text PRIMARY KEY NOT NULL,
  `source_type` text NOT NULL,
  `source_id` text NOT NULL,
  `signal` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `feedback_source_idx` ON `feedback` (`source_type`, `source_id`);
--> statement-breakpoint
CREATE INDEX `feedback_signal_idx` ON `feedback` (`signal`);
--> statement-breakpoint
-- Phase 10: adversarial gate — log the "strongest case against" check per run
ALTER TABLE `runs` ADD COLUMN `adversarial_note` text;
