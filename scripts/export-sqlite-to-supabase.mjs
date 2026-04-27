#!/usr/bin/env node
/* global console, process */
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createClient } from '@supabase/supabase-js'

const dbPath = resolve(process.env.HUB_DB_PATH ?? 'data/hub.db')
const url = process.env.SUPABASE_URL ?? process.env.CONSULTING_SUPABASE_URL
const key =
  process.env.SUPABASE_SECRET_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.CONSULTING_SUPABASE_SERVICE_ROLE_KEY

if (!existsSync(dbPath)) {
  throw new Error(`SQLite database not found at ${dbPath}`)
}

if (!url || !key) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.')
}

const sqlite = new DatabaseSync(dbPath, { readOnly: true })
const supabase = createClient(url, key, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
})

const tableConfigs = [
  {
    source: 'captures',
    target: 'captures',
    columns: {
      id: 'id',
      source: 'source',
      received_at: 'received_at',
      content_hash: 'content_hash',
      raw_content_ref: 'raw_content_ref',
      classified_domain: 'classified_domain',
      classified_type: 'classified_type',
      confidence: 'confidence',
      entities_json: 'entities_json',
      action_items_json: 'action_items_json',
      decisions_json: 'decisions_json',
      dispatched_to_json: 'dispatched_to_json',
      model_used: 'model_used',
      status: 'status',
      error_message: 'error_message',
    },
    jsonColumns: ['entities_json', 'action_items_json', 'decisions_json', 'dispatched_to_json'],
    onConflict: 'id',
  },
  {
    source: 'runs',
    target: 'runs',
    columns: {
      id: 'id',
      agent_name: 'agent_name',
      parent_run_id: 'parent_run_id',
      started_at: 'started_at',
      ended_at: 'ended_at',
      model_used: 'model_used',
      input_tokens: 'input_tokens',
      output_tokens: 'output_tokens',
      cost_usd: 'cost_usd',
      status: 'status',
      mcp_servers_json: 'mcp_servers_json',
      subagents_json: 'subagents_json',
      permission_tier: 'permission_tier',
      reversal_payload: 'reversal_payload',
      reversed_at: 'reversed_at',
      error_message: 'error_message',
      output_ref: 'output_ref',
      prompt_id: 'prompt_id',
      prompt_version: 'prompt_version',
      target_repo: 'target_repo',
      run_trigger: 'run_trigger',
      adversarial_note: 'adversarial_note',
    },
    jsonColumns: ['mcp_servers_json', 'subagents_json'],
    onConflict: 'id',
  },
  {
    source: 'briefings',
    target: 'briefings',
    columns: {
      date: 'date',
      generated_at: 'generated_at',
      run_id: 'run_id',
      obsidian_ref: 'obsidian_ref',
      rating: 'rating',
      notes: 'notes',
      body: 'body',
    },
    onConflict: 'date',
  },
  {
    source: 'projects',
    target: 'projects',
    columns: {
      slug: 'slug',
      name: 'name',
      domain: 'domain',
      notion_page_id: 'notion_page_id',
      linear_team_key: 'linear_team_key',
      todoist_project_id: 'todoist_project_id',
      obsidian_folder: 'obsidian_folder',
      status: 'status',
      last_activity_at: 'last_activity_at',
    },
    onConflict: 'slug',
  },
  {
    source: 'agent_locks',
    target: 'agent_locks',
    columns: {
      agent_name: 'agent_name',
      pid: 'pid',
      acquired_at: 'acquired_at',
      lease_until: 'lease_until',
      holder_hostname: 'holder_hostname',
    },
    onConflict: 'agent_name',
  },
  {
    source: 'feedback',
    target: 'feedback',
    columns: {
      id: 'id',
      source_type: 'source_type',
      source_id: 'source_id',
      signal: 'signal',
      created_at: 'created_at',
    },
    onConflict: 'id',
  },
  {
    source: 'prompts',
    target: 'prompts',
    columns: {
      id: 'id',
      version: 'version',
      source_sha: 'source_sha',
      title: 'title',
      description: 'description',
      body: 'body',
      sensitivity: 'sensitivity',
      complexity: 'complexity',
      inputs_schema: 'inputs_schema',
      output_config: 'output_config',
      tags: 'tags',
      synced_at: 'synced_at',
      enabled: 'enabled',
    },
    jsonColumns: ['inputs_schema', 'output_config', 'tags'],
    booleanColumns: ['enabled'],
    onConflict: 'id',
  },
  {
    source: 'prompt_targets',
    target: 'prompt_targets',
    columns: {
      id: 'id',
      repo: 'repo',
      prompt_id: 'prompt_id',
      trigger: 'trigger',
      when_expr: 'when_expr',
      branch: 'branch',
      sensitivity_override: 'sensitivity_override',
      args: 'args',
      enabled: 'enabled',
      source_sha: 'source_sha',
      synced_at: 'synced_at',
      last_run_id: 'last_run_id',
      last_run_at: 'last_run_at',
    },
    jsonColumns: ['args'],
    booleanColumns: ['enabled'],
    onConflict: 'id',
  },
]

for (const config of tableConfigs) {
  if (!tableExists(config.source)) {
    console.log(`skip ${config.source}: table missing`)
    continue
  }

  const rows = sqlite.prepare(`select * from ${config.source}`).all()
  if (rows.length === 0) {
    console.log(`skip ${config.source}: no rows`)
    continue
  }

  const mapped = rows.map((row) => mapRow(row, config))
  for (const batch of chunk(mapped, 250)) {
    const { error } = await supabase.from(config.target).upsert(batch, {
      onConflict: config.onConflict,
    })
    if (error) throw new Error(`${config.target}: ${error.message}`)
  }
  console.log(`upserted ${mapped.length} rows into ${config.target}`)
}

sqlite.close()

function mapRow(row, config) {
  const out = {}
  for (const [target, source] of Object.entries(config.columns)) {
    out[target] = row[source] ?? null
  }

  for (const column of config.jsonColumns ?? []) {
    out[column] = parseJson(
      out[column],
      column === 'inputs_schema' ? null : column.endsWith('config') ? {} : [],
    )
  }

  for (const column of config.booleanColumns ?? []) {
    out[column] = Boolean(out[column])
  }

  return out
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function tableExists(name) {
  const row = sqlite
    .prepare("select name from sqlite_master where type = 'table' and name = ?")
    .get(name)
  return Boolean(row)
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}
