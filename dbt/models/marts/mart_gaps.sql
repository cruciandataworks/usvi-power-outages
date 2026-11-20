-- Where the record is blind. MISSING: more than 12 minutes between two saved polls.
-- STALE: a run of polls where WAPA's own update time was more than 30 minutes old, so
-- the map was showing old data. Neither is ever counted as zero customers out.
with p as (
    select poll_utc, poll_ast, source, is_stale,
           lag(poll_ast) over (partition by source order by poll_utc) as prev_ast,
           lag(is_stale) over (partition by source order by poll_utc) as prev_stale
    from {{ ref('int_poll_status') }}
),
missing as (
    select 'MISSING' as kind, source, prev_ast as start_ast, poll_ast as end_ast
    from p where date_diff('second', prev_ast, poll_ast) > {{ var('missing_after_min') }} * 60
),
stale_runs as (
    select 'STALE' as kind, source, min(poll_ast) as start_ast, max(poll_ast) as end_ast
    from (select *, sum(case when is_stale and prev_stale is distinct from true then 1 else 0 end)
                     over (partition by source order by poll_utc) as run_no
          from p) where is_stale
    group by source, run_no
),
between_captures as (
    select 'MISSING' as kind, 'between' as source,
           (select max(poll_ast) from p where source = 'archive') as start_ast,
           (select min(poll_ast) from p where source = 'live')    as end_ast
),
all_gaps as (
    select * from missing union all select * from stale_runs
    union all select * from between_captures where start_ast is not null and end_ast is not null
),
ref_causes as (   -- archive gaps: VI Update's own note on each one, where it has one
    select kind, start_ast, cause from {{ ref('stg_ref_holes') }}
),
failures as (   -- live gaps: why our requests failed, from the poll log
    select poll_utc, error from {{ ref('stg_poll_log') }} where not ok
)
select
    g.kind, g.source, g.start_ast, g.end_ast,
    round(date_diff('second', g.start_ast, g.end_ast) / 3600.0, 2) as hours,
    case when g.source = 'between' then 'between VI Update''s capture (ended 7 Nov 2026) and ours'
         when g.kind = 'STALE' and g.source = 'live' then 'WAPA''s update time was more than 30 minutes behind'
         when g.source = 'archive' then coalesce(
             (select any_value(r.cause) from ref_causes r
              where r.kind = g.kind and abs(date_diff('second', r.start_ast, g.start_ast)) < 120),
             'no poll saved in the archive (cause not recorded)')
         else coalesce((select any_value(f.error) from failures f
                        where {{ to_ast('f.poll_utc') }} between g.start_ast and g.end_ast),
                       'no run in this window (GitHub started the schedule late)') end as cause
from all_gaps g
