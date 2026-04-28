import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { getDb } from '@hub/db'
import { mcpConsents } from '@hub/db/schema'
import { type AskMode, legacyDomainToLifeArea, type LifeArea } from '@hub/shared'
import { getDomainAuthority } from './context.js'
import type { McpScopeName } from './mcp-config.js'

export type AuthorityLevel = 'suggest' | 'draft' | 'act'

export interface AskPolicyInput {
  mode?: AskMode | undefined
  lifeArea?: LifeArea | undefined
  projectRef?: string | undefined
  requestedScopes?: string[] | undefined
  governorDomain?: string | undefined
  legacyDomain?: string | undefined
}

export interface ScopeDecision {
  scope: McpScopeName
  reason: string
}

export interface AskPolicyResult {
  mode: AskMode
  lifeArea?: LifeArea
  projectRef?: string
  governorDomain: string
  authority: AuthorityLevel
  appliedScopes: McpScopeName[]
  deniedScopes: ScopeDecision[]
  permissionTier: 'R0' | 'R2' | 'R3'
}

const ALL_SCOPES: McpScopeName[] = ['knowledge', 'workspace', 'tasks', 'code', 'system']
const WRITE_SCOPES = new Set<McpScopeName>(['workspace', 'tasks', 'code', 'system'])
const HIGH_AUTHORITY_SCOPES = new Set<McpScopeName>(['code', 'system'])

export async function resolveAskPolicy(input: AskPolicyInput): Promise<AskPolicyResult> {
  const mode = input.mode ?? 'clarify'
  const lifeArea = input.lifeArea ?? legacyDomainToLifeArea(input.legacyDomain)
  const projectRef = input.projectRef?.trim() || undefined
  const governorDomain =
    input.governorDomain?.trim() || projectRef || lifeArea || input.legacyDomain?.trim() || 'misc'
  const authority = getDomainAuthority(governorDomain)
  const requestedScopes = normalizeScopes(input.requestedScopes)

  const appliedScopes: McpScopeName[] = ['knowledge']
  const deniedScopes: ScopeDecision[] = []

  for (const scope of requestedScopes) {
    if (scope === 'knowledge') continue

    if (!WRITE_SCOPES.has(scope)) {
      appliedScopes.push(scope)
      continue
    }

    if (mode !== 'execute') {
      deniedScopes.push({ scope, reason: 'write scopes require execute mode' })
      continue
    }

    if (authority === 'suggest') {
      deniedScopes.push({ scope, reason: 'life-area authority is still suggest' })
      continue
    }

    if (authority === 'draft' && HIGH_AUTHORITY_SCOPES.has(scope)) {
      deniedScopes.push({ scope, reason: 'code/system scopes require act authority' })
      continue
    }

    if (!(await hasScopeConsent(scope))) {
      deniedScopes.push({ scope, reason: 'stored consent required before first use' })
      continue
    }

    appliedScopes.push(scope)
  }

  return {
    mode,
    ...(lifeArea ? { lifeArea } : {}),
    ...(projectRef ? { projectRef } : {}),
    governorDomain,
    authority,
    appliedScopes,
    deniedScopes,
    permissionTier: derivePermissionTier(appliedScopes),
  }
}

function normalizeScopes(requestedScopes?: string[]): McpScopeName[] {
  const seen = new Set<McpScopeName>()
  for (const scope of requestedScopes ?? []) {
    if (ALL_SCOPES.includes(scope as McpScopeName)) {
      seen.add(scope as McpScopeName)
    }
  }
  return [...seen]
}

function derivePermissionTier(scopes: McpScopeName[]): 'R0' | 'R2' | 'R3' {
  if (scopes.includes('system')) return 'R3'
  if (scopes.some((scope) => WRITE_SCOPES.has(scope))) return 'R2'
  return 'R0'
}

async function hasScopeConsent(scope: McpScopeName): Promise<boolean> {
  const now = Date.now()
  const db = getDb()
  const row = await db
    .select({ id: mcpConsents.id })
    .from(mcpConsents)
    .where(
      and(
        eq(mcpConsents.serverName, `scope:${scope}`),
        or(isNull(mcpConsents.expiresAt), gt(mcpConsents.expiresAt, now)),
      ),
    )
    .get()
  return !!row
}
