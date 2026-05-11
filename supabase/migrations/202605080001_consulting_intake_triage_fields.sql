-- Add structured consulting triage fields for the public /start flow.
-- Existing legacy summary columns stay required for backward compatibility.

alter table public.intake_submissions
  add column if not exists phone text,
  add column if not exists project_goal text,
  add column if not exists offer_door text,
  add column if not exists primary_friction text,
  add column if not exists current_state text,
  add column if not exists success_outcome text,
  add column if not exists timeline text,
  add column if not exists investment_readiness text,
  add column if not exists call_context text,
  add column if not exists triage_version text;

alter table public.intake_submissions
  drop constraint if exists intake_submissions_phone_len,
  add constraint intake_submissions_phone_len
    check (phone is null or char_length(trim(phone)) <= 40),
  drop constraint if exists intake_submissions_project_goal_len,
  add constraint intake_submissions_project_goal_len
    check (project_goal is null or char_length(trim(project_goal)) <= 220),
  drop constraint if exists intake_submissions_offer_door_len,
  add constraint intake_submissions_offer_door_len
    check (offer_door is null or char_length(trim(offer_door)) <= 120),
  drop constraint if exists intake_submissions_primary_friction_len,
  add constraint intake_submissions_primary_friction_len
    check (primary_friction is null or char_length(trim(primary_friction)) <= 220),
  drop constraint if exists intake_submissions_current_state_len,
  add constraint intake_submissions_current_state_len
    check (current_state is null or char_length(trim(current_state)) <= 220),
  drop constraint if exists intake_submissions_success_outcome_len,
  add constraint intake_submissions_success_outcome_len
    check (success_outcome is null or char_length(trim(success_outcome)) <= 220),
  drop constraint if exists intake_submissions_timeline_len,
  add constraint intake_submissions_timeline_len
    check (timeline is null or char_length(trim(timeline)) <= 120),
  drop constraint if exists intake_submissions_investment_readiness_len,
  add constraint intake_submissions_investment_readiness_len
    check (investment_readiness is null or char_length(trim(investment_readiness)) <= 260),
  drop constraint if exists intake_submissions_call_context_len,
  add constraint intake_submissions_call_context_len
    check (call_context is null or char_length(trim(call_context)) <= 1400),
  drop constraint if exists intake_submissions_triage_version_len,
  add constraint intake_submissions_triage_version_len
    check (triage_version is null or char_length(trim(triage_version)) <= 80);

comment on column public.intake_submissions.phone is
  'Optional prospect phone submitted from the consulting Fit Call triage.';

comment on column public.intake_submissions.project_goal is
  'Structured answer: what the prospect is trying to move forward.';

comment on column public.intake_submissions.offer_door is
  'Structured answer: closest consulting door.';

comment on column public.intake_submissions.primary_friction is
  'Structured answer: current primary friction.';

comment on column public.intake_submissions.current_state is
  'Structured answer: what already exists.';

comment on column public.intake_submissions.success_outcome is
  'Structured answer: what would make the engagement successful.';

comment on column public.intake_submissions.timeline is
  'Structured answer: how soon this needs to move.';

comment on column public.intake_submissions.investment_readiness is
  'Structured answer: soft investment readiness.';

comment on column public.intake_submissions.call_context is
  'Free-text context submitted before the Fit Call.';

comment on column public.intake_submissions.triage_version is
  'Version label for the public consulting triage form contract.';
