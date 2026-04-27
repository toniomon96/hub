import { getSupabaseAdmin, isSupabaseConfigured } from './supabase'

export type TodoStatus = 'open' | 'done' | 'archived'
export type TodoPriority = 'normal' | 'high'
export type OutreachStatus = 'sent' | 'replied' | 'declined' | 'converted' | 'stale'
export type IntakeStatus = 'new' | 'reviewed' | 'fit' | 'not_fit' | 'archived'

export interface ConsoleTodo {
  id: string
  title: string
  status: TodoStatus
  priority: TodoPriority
  week_of: string
  source: string
  completed_at: string | null
  created_at: string
  updated_at: string
}

export interface ConsoleOutreachEvent {
  id: string
  happened_on: string
  date: string
  name: string
  channel: string
  ask: string
  status: OutreachStatus
  notes: string
  created_at: string
  updated_at: string
}

export interface ConsoleIntakeSubmission {
  id: string
  submitted_at: string
  name: string
  email: string
  project: string
  messy_context: string
  already_tried: string
  thirty_day_target: string
  private_context: string
  source: string
  status: IntakeStatus
}

export interface OperationalData {
  configured: boolean
  warnings: string[]
  todos: ConsoleTodo[]
  outreach: ConsoleOutreachEvent[]
  intake: ConsoleIntakeSubmission[]
}

export interface TodoCreateInput {
  title: string
  priority: TodoPriority
  week_of: string
  source: string
}

export interface TodoPatchInput {
  id: string
  title?: string
  status?: TodoStatus
  priority?: TodoPriority
  week_of?: string
}

export interface OutreachCreateInput {
  happened_on: string
  name: string
  channel: string
  ask: string
  status: OutreachStatus
  notes: string
}

export interface OutreachPatchInput {
  id: string
  happened_on?: string
  name?: string
  channel?: string
  ask?: string
  status?: OutreachStatus
  notes?: string
}

export interface IntakeCreateInput {
  name: string
  email: string
  project: string
  messy_context: string
  already_tried: string
  thirty_day_target: string
  private_context: string
  source: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

const TODO_STATUSES = new Set<TodoStatus>(['open', 'done', 'archived'])
const TODO_PRIORITIES = new Set<TodoPriority>(['normal', 'high'])
const OUTREACH_STATUSES = new Set<OutreachStatus>([
  'sent',
  'replied',
  'declined',
  'converted',
  'stale',
])
const INTAKE_STATUSES = new Set<IntakeStatus>(['new', 'reviewed', 'fit', 'not_fit', 'archived'])

export class ConsoleStoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

export async function loadOperationalData(): Promise<OperationalData> {
  if (!isSupabaseConfigured()) {
    return {
      configured: false,
      warnings: [
        'Supabase operations are not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY.',
      ],
      todos: [],
      outreach: [],
      intake: [],
    }
  }

  const [todos, outreach, intake] = await Promise.all([
    listTodos(60),
    listOutreachEvents(60),
    listIntakeSubmissions(20),
  ])

  return { configured: true, warnings: [], todos, outreach, intake }
}

export async function listTodos(limit = 50): Promise<ConsoleTodo[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('admin_todos')
    .select('*')
    .neq('status', 'archived')
    .order('week_of', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw mapStoreError(error.message)
  return asRows(data).map(toTodo)
}

export async function createTodo(input: TodoCreateInput): Promise<ConsoleTodo> {
  const { data, error } = await getSupabaseAdmin()
    .from('admin_todos')
    .insert({
      title: input.title,
      priority: input.priority,
      week_of: input.week_of,
      source: input.source,
    })
    .select('*')
    .single()

  if (error) throw mapStoreError(error.message)
  return toTodo(asRow(data))
}

export async function updateTodo(input: TodoPatchInput): Promise<ConsoleTodo> {
  const updates: Record<string, unknown> = {}
  if (input.title !== undefined) updates['title'] = input.title
  if (input.priority !== undefined) updates['priority'] = input.priority
  if (input.week_of !== undefined) updates['week_of'] = input.week_of
  if (input.status !== undefined) {
    updates['status'] = input.status
    updates['completed_at'] = input.status === 'done' ? new Date().toISOString() : null
  }

  if (Object.keys(updates).length === 0) {
    throw new ConsoleStoreError(400, 'No todo fields were provided for update.')
  }

  const { data, error } = await getSupabaseAdmin()
    .from('admin_todos')
    .update(updates)
    .eq('id', input.id)
    .select('*')
    .single()

  if (error) throw mapStoreError(error.message)
  return toTodo(asRow(data))
}

export async function archiveTodo(id: string): Promise<ConsoleTodo> {
  return updateTodo({ id, status: 'archived' })
}

export async function listOutreachEvents(limit = 50): Promise<ConsoleOutreachEvent[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('outreach_events')
    .select('*')
    .order('happened_on', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw mapStoreError(error.message)
  return asRows(data).map(toOutreachEvent)
}

export async function createOutreachEvent(
  input: OutreachCreateInput,
): Promise<ConsoleOutreachEvent> {
  const { data, error } = await getSupabaseAdmin()
    .from('outreach_events')
    .insert(input)
    .select('*')
    .single()

  if (error) throw mapStoreError(error.message)
  return toOutreachEvent(asRow(data))
}

export async function updateOutreachEvent(
  input: OutreachPatchInput,
): Promise<ConsoleOutreachEvent> {
  const updates: Record<string, unknown> = {}
  for (const key of ['happened_on', 'name', 'channel', 'ask', 'status', 'notes'] as const) {
    if (input[key] !== undefined) updates[key] = input[key]
  }

  if (Object.keys(updates).length === 0) {
    throw new ConsoleStoreError(400, 'No outreach fields were provided for update.')
  }

  const { data, error } = await getSupabaseAdmin()
    .from('outreach_events')
    .update(updates)
    .eq('id', input.id)
    .select('*')
    .single()

  if (error) throw mapStoreError(error.message)
  return toOutreachEvent(asRow(data))
}

export async function archiveOutreachEvent(id: string): Promise<ConsoleOutreachEvent> {
  return updateOutreachEvent({ id, status: 'stale' })
}

export async function listIntakeSubmissions(limit = 20): Promise<ConsoleIntakeSubmission[]> {
  const { data, error } = await getSupabaseAdmin()
    .from('intake_submissions')
    .select(
      'id, submitted_at, name, email, project, messy_context, already_tried, thirty_day_target, private_context, source, status',
    )
    .order('submitted_at', { ascending: false })
    .limit(limit)

  if (error) throw mapStoreError(error.message)
  return asRows(data).map(toIntakeSubmission)
}

export async function createIntakeSubmission(
  input: IntakeCreateInput,
): Promise<ConsoleIntakeSubmission> {
  const { data, error } = await getSupabaseAdmin()
    .from('intake_submissions')
    .insert(input)
    .select(
      'id, submitted_at, name, email, project, messy_context, already_tried, thirty_day_target, private_context, source, status',
    )
    .single()

  if (error) throw mapStoreError(error.message)
  return toIntakeSubmission(asRow(data))
}

export function parseTodoCreateInput(body: Record<string, unknown>): ParseResult<TodoCreateInput> {
  const title = cleanString(body['title'], 180)
  if (!title) return { ok: false, error: 'Todo title is required.' }

  const rawPriority = cleanString(body['priority'], 20)
  const priority: TodoPriority =
    rawPriority === 'high' || body['priority'] === true ? 'high' : 'normal'

  const weekOf = cleanDate(body['week_of']) ?? currentWeekMonday()
  const source = cleanString(body['source'], 80) ?? 'console'
  return { ok: true, value: { title, priority, week_of: weekOf, source } }
}

export function parseTodoPatchInput(body: Record<string, unknown>): ParseResult<TodoPatchInput> {
  const id = cleanString(body['id'], 80)
  if (!id) return { ok: false, error: 'Todo id is required.' }

  const value: TodoPatchInput = { id }
  const title = cleanString(body['title'], 180)
  if (title) value.title = title

  const status = cleanString(body['status'], 20)
  if (status) {
    if (!TODO_STATUSES.has(status as TodoStatus)) {
      return { ok: false, error: 'Todo status must be open, done, or archived.' }
    }
    value.status = status as TodoStatus
  }

  const priority = cleanString(body['priority'], 20)
  if (priority) {
    if (!TODO_PRIORITIES.has(priority as TodoPriority)) {
      return { ok: false, error: 'Todo priority must be normal or high.' }
    }
    value.priority = priority as TodoPriority
  }

  const weekOf = cleanDate(body['week_of'])
  if (weekOf) value.week_of = weekOf
  return { ok: true, value }
}

export function parseOutreachCreateInput(
  body: Record<string, unknown>,
): ParseResult<OutreachCreateInput> {
  const name = cleanString(body['name'], 160)
  const channel = cleanString(body['channel'], 80)
  const ask = cleanString(body['ask'], 240)
  if (!name || !channel || !ask) {
    return { ok: false, error: 'Name, channel, and ask are required for outreach.' }
  }

  const status = parseOutreachStatus(body['status'])
  if (!status.ok) return status

  return {
    ok: true,
    value: {
      happened_on: cleanDate(body['happened_on']) ?? todayDate(),
      name,
      channel,
      ask,
      status: status.value,
      notes: cleanString(body['notes'], 1000) ?? '',
    },
  }
}

export function parseOutreachPatchInput(
  body: Record<string, unknown>,
): ParseResult<OutreachPatchInput> {
  const id = cleanString(body['id'], 80)
  if (!id) return { ok: false, error: 'Outreach id is required.' }

  const value: OutreachPatchInput = { id }
  const happenedOn = cleanDate(body['happened_on'])
  if (happenedOn) value.happened_on = happenedOn

  for (const [key, max] of [
    ['name', 160],
    ['channel', 80],
    ['ask', 240],
    ['notes', 1000],
  ] as const) {
    const text = cleanString(body[key], max)
    if (text !== null) value[key] = text
  }

  if (body['status'] !== undefined) {
    const status = parseOutreachStatus(body['status'])
    if (!status.ok) return status
    value.status = status.value
  }

  return { ok: true, value }
}

export function parseIntakeCreateInput(
  body: Record<string, unknown>,
): ParseResult<IntakeCreateInput> {
  const trap = cleanString(body['_gotcha'], 120)
  if (trap) return { ok: false, error: 'Submission rejected.' }

  const name = cleanString(body['name'], 160)
  const email = cleanString(body['email'], 240)
  const project = cleanString(body['project'], 180)
  const messyContext = cleanString(body['messy_context'], 1400)
  const thirtyDayTarget = cleanString(body['thirty_day_target'], 1000)

  if (!name || !email || !project || !messyContext || !thirtyDayTarget) {
    return {
      ok: false,
      error: 'Name, email, project, current mess, and 30-day target are required.',
    }
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'A valid email is required.' }
  }

  return {
    ok: true,
    value: {
      name,
      email,
      project,
      messy_context: messyContext,
      already_tried: cleanString(body['already_tried'], 1000) ?? '',
      thirty_day_target: thirtyDayTarget,
      private_context: cleanString(body['private_context'], 1000) ?? '',
      source: cleanString(body['source'], 80) ?? 'tonimontez.co',
    },
  }
}

export function countOutreachThisWeek(rows: ConsoleOutreachEvent[], weekOf: string | null): number {
  if (!weekOf) return rows.length
  const start = new Date(`${weekOf}T00:00:00`)
  const end = new Date(start)
  end.setDate(start.getDate() + 7)
  return rows.filter((row) => {
    const date = new Date(`${row.happened_on}T00:00:00`)
    return date >= start && date < end
  }).length
}

function parseOutreachStatus(value: unknown): ParseResult<OutreachStatus> {
  const status = cleanString(value, 20) ?? 'sent'
  if (!OUTREACH_STATUSES.has(status as OutreachStatus)) {
    return {
      ok: false,
      error: 'Outreach status must be sent, replied, declined, converted, or stale.',
    }
  }
  return { ok: true, value: status as OutreachStatus }
}

function mapStoreError(message: string): ConsoleStoreError {
  return new ConsoleStoreError(500, message)
}

function toTodo(row: Record<string, unknown>): ConsoleTodo {
  const status = stringField(row, 'status')
  const priority = stringField(row, 'priority')
  return {
    id: stringField(row, 'id'),
    title: stringField(row, 'title'),
    status: TODO_STATUSES.has(status as TodoStatus) ? (status as TodoStatus) : 'open',
    priority: TODO_PRIORITIES.has(priority as TodoPriority) ? (priority as TodoPriority) : 'normal',
    week_of: dateField(row, 'week_of'),
    source: stringField(row, 'source') || 'console',
    completed_at: nullableStringField(row, 'completed_at'),
    created_at: stringField(row, 'created_at'),
    updated_at: stringField(row, 'updated_at'),
  }
}

function toOutreachEvent(row: Record<string, unknown>): ConsoleOutreachEvent {
  const status = stringField(row, 'status')
  const happenedOn = dateField(row, 'happened_on')
  return {
    id: stringField(row, 'id'),
    happened_on: happenedOn,
    date: happenedOn,
    name: stringField(row, 'name'),
    channel: stringField(row, 'channel'),
    ask: stringField(row, 'ask'),
    status: OUTREACH_STATUSES.has(status as OutreachStatus) ? (status as OutreachStatus) : 'sent',
    notes: nullableStringField(row, 'notes') ?? '',
    created_at: stringField(row, 'created_at'),
    updated_at: stringField(row, 'updated_at'),
  }
}

function toIntakeSubmission(row: Record<string, unknown>): ConsoleIntakeSubmission {
  const status = stringField(row, 'status')
  return {
    id: stringField(row, 'id'),
    submitted_at: stringField(row, 'submitted_at'),
    name: stringField(row, 'name'),
    email: stringField(row, 'email'),
    project: stringField(row, 'project'),
    messy_context: stringField(row, 'messy_context'),
    already_tried: nullableStringField(row, 'already_tried') ?? '',
    thirty_day_target: stringField(row, 'thirty_day_target'),
    private_context: nullableStringField(row, 'private_context') ?? '',
    source: stringField(row, 'source') || 'tonimontez.co',
    status: INTAKE_STATUSES.has(status as IntakeStatus) ? (status as IntakeStatus) : 'new',
  }
}

function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.replace(/\s+/g, ' ').trim()
  if (!clean) return null
  return clean.slice(0, max)
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(clean) ? clean : null
}

function todayDate(): string {
  return formatDate(new Date())
}

function currentWeekMonday(): string {
  const date = new Date()
  const day = date.getDay()
  const diff = day === 0 ? -6 : 1 - day
  date.setDate(date.getDate() + diff)
  return formatDate(date)
}

function formatDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function asRow(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ConsoleStoreError(500, 'Supabase returned an invalid row.')
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringField(row: Record<string, unknown>, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value : ''
}

function nullableStringField(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function dateField(row: Record<string, unknown>, key: string): string {
  const value = stringField(row, key)
  return value.slice(0, 10)
}
