import { z } from 'zod'

/**
 * Prompt frontmatter schema — validates YAML front matter in hub-prompts/*.md.
 * Complexity enum uses the router's vocabulary (trivial/moderate/complex).
 * The spec DB column is 'standard' but the router expects 'moderate'; the
 * dispatcher translates 'standard' → 'moderate' before routing.
 */
export const PromptFrontmatter = z.object({
  id: z.string().min(1),
  version: z.number().int().positive(),
  title: z.string().min(1),
  description: z.string(),
  sensitivity: z.enum(['low', 'medium', 'high']),
  complexity: z.enum(['trivial', 'standard', 'complex']),
  inputs_schema: z.record(z.string(), z.unknown()).optional(),
  output_config: z.record(z.string(), z.unknown()),
  tags: z.array(z.string()).optional(),
})
export type PromptFrontmatter = z.infer<typeof PromptFrontmatter>

/** One target entry within a repo block in targets.yml. */
export const TargetEntry = z.object({
  prompt_id: z.string().min(1),
  trigger: z.string().min(1),
  when_expr: z.string().optional(),
  branch: z.string().default('main'),
  sensitivity_override: z.enum(['low', 'medium', 'high']).optional(),
  args: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().default(true),
})
export type TargetEntry = z.infer<typeof TargetEntry>

/** One repo block in targets.yml. */
export const RepoBlock = z.object({
  repo: z.string().min(1),
  branch: z.string().optional(),
  sensitivity: z.enum(['low', 'medium', 'high']).optional(),
  enabled: z.boolean().optional(),
  targets: z.array(TargetEntry),
})
export type RepoBlock = z.infer<typeof RepoBlock>

/** Top-level structure of hub-registry/targets.yml. */
export const RegistryFile = z.object({
  targets: z.array(RepoBlock),
})
export type RegistryFile = z.infer<typeof RegistryFile>

/** Output config shapes — validated when output handlers run. */
export const ObsidianOutputConfig = z.object({
  path_template: z.string(),
})

export const GithubIssueOutputConfig = z.object({
  title: z.string(),
  labels: z.array(z.string()).optional(),
})

export const GithubPrCommentOutputConfig = z.object({
  pr_number_arg: z.string().optional().default('pr_number'),
})

export const NtfyOnOutputConfig = z.object({
  priority: z.number().int().min(1).max(5).optional(),
})
