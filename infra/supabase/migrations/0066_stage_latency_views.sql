-- 0066_stage_latency_views.sql
-- Read-side latency analytics over job_telemetry.metrics. The pipeline (lib/agent/process.ts) writes
-- metrics.stages_ms = { "<stage>": <milliseconds>, ... } alongside metrics.latency_ms; no table changes here.
-- Jobs recorded before stage timing shipped have no stages_ms and simply yield no stage rows.

create or replace view public.job_stage_latency
with (security_invoker = true) as
select
  t.job_id,
  t.created_at,
  t.metrics ->> 'plan'     as plan,
  t.metrics ->> 'language' as language,
  nullif(t.metrics ->> 'target_s', '')::numeric as target_s,
  nullif(t.metrics ->> 'latency_ms', '')::numeric as total_ms,
  s.key                    as stage,
  s.value::numeric         as stage_ms
from public.job_telemetry t
cross join lateral jsonb_each_text(
  case when jsonb_typeof(t.metrics -> 'stages_ms') = 'object' then t.metrics -> 'stages_ms' else '{}'::jsonb end
) s
where s.value ~ '^[0-9]+(\.[0-9]+)?$';

-- p50/p90/max per stage (ms) for completed jobs in a window; optionally one plan and a target length.
create or replace function public.stage_latency_summary(
  p_since timestamptz default now() - interval '7 days',
  p_plan text default null,
  p_target_s numeric default null
) returns table (stage text, n bigint, p50_ms numeric, p90_ms numeric, max_ms numeric, share_of_total numeric)
language sql stable security invoker set search_path = public as $$
  select v.stage,
         count(*) as n,
         (percentile_cont(0.5) within group (order by v.stage_ms))::numeric(12,0) as p50_ms,
         (percentile_cont(0.9) within group (order by v.stage_ms))::numeric(12,0) as p90_ms,
         max(v.stage_ms) as max_ms,
         round(sum(v.stage_ms) / nullif(sum(v.total_ms), 0), 3) as share_of_total
    from public.job_stage_latency v
    join public.jobs j on j.id = v.job_id and j.status = 'completed'
   where v.created_at >= p_since
     and (p_plan is null or v.plan = p_plan)
     and (p_target_s is null or v.target_s = p_target_s)
   group by v.stage
   order by p50_ms desc;
$$;

revoke all on public.job_stage_latency from public, anon, authenticated;
revoke all on function public.stage_latency_summary(timestamptz, text, numeric) from public, anon, authenticated;
grant select on public.job_stage_latency to service_role;
grant execute on function public.stage_latency_summary(timestamptz, text, numeric) to service_role;
