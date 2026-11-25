-- WAPA's rotation schedule against what WAPA's own map showed.
--
-- One row per scheduled (window, feeder), plus one row per power-supply feeder outage
-- on a scheduled day that no window explains ("unscheduled"). A scheduled feeder matches
-- an outage of the same feeder that overlaps the window, allowing 30 minutes either side
-- (WAPA says restoration may run up to 20 minutes late). If several match, the one that
-- started closest to the window's start wins.
--
--   on_schedule   started within 30 minutes of the window and was cleared by 20 minutes after it
--   ran_long      started on time but was still on the map more than 20 minutes after the window
--   off_time      an outage overlapped the window but started more than 30 minutes away from it
--   not_seen      no outage of that whole feeder appeared on the map. It may not have been
--                 carried out ("not all feeders listed may be affected"), or WAPA may have cut
--                 only part of the feeder, which the map lists under a switch, not the feeder.
--   still_out     the matched outage is still on the map at the latest poll
--   upcoming      the window has not finished yet
--   not_recorded  we were not polling WAPA's map at the time
with s as (
    select * from {{ ref('int_schedule_final') }}
),
o as (
    select * from {{ ref('mart_feeder_outages') }}
),
latest as (
    select max(poll_ast) as poll_ast from {{ ref('int_poll_status') }} where outages_captured
),
covered as (  -- the hours our record covers (archive + live polls)
    select min(poll_ast) as first_ast from {{ ref('int_poll_status') }}
),
cand as (
    select
        s.*, o.record_id, o.start_ast, o.end_ast, o.hours, o.cause, o.is_power_supply, o.on_map_now,
        row_number() over (partition by s.district, s.window_start_ast, s.feeder
                           order by abs(date_diff('second', o.start_ast, s.window_start_ast))) as rn
    from s
    join o on o.district = s.district and o.feeder = s.feeder
          and o.start_ast < s.window_end_ast + interval 30 minute
          and o.end_ast   > s.window_start_ast - interval 30 minute
),
matched as (
    select s.*, c.record_id, c.start_ast, c.end_ast, c.hours, c.cause, c.on_map_now
    from s left join cand c
      on c.rn = 1 and c.district = s.district and c.window_start_ast = s.window_start_ast and c.feeder = s.feeder
),
scheduled as (
    select
        'scheduled' as kind, m.district, m.schedule_date, m.window_label, m.window_start_ast, m.window_end_ast,
        m.feeder, m.partial, m.area, m.versions_of_day, m.record_id, m.start_ast, m.end_ast, m.hours, m.cause,
        round(date_diff('second', m.window_start_ast, m.start_ast) / 60.0) as start_offset_min,
        round(date_diff('second', m.window_end_ast, m.end_ast) / 60.0)     as end_offset_min,
        coalesce(m.on_map_now, false)                                      as still_on_map,
        case
            when m.record_id is null and m.window_end_ast > l.poll_ast        then 'upcoming'
            when m.record_id is null and m.window_start_ast < cv.first_ast    then 'not_recorded'
            when m.record_id is null                                          then 'not_seen'
            when m.on_map_now and m.end_ast > m.window_end_ast + interval 20 minute then 'still_out'
            when abs(date_diff('minute', m.window_start_ast, m.start_ast)) > 30 then 'off_time'
            when m.end_ast > m.window_end_ast + interval 20 minute            then 'ran_long'
            else 'on_schedule'
        end as outcome
    from matched m cross join latest l cross join covered cv
),
unscheduled as (
    select
        'unscheduled', o.district, cast(o.start_ast as date), null, null, null,
        o.feeder, null, null, null, o.record_id, o.start_ast, o.end_ast, o.hours, o.cause,
        null, null, o.on_map_now, 'unscheduled'
    from o
    where o.is_power_supply
      and exists (select 1 from s where s.district = o.district and s.schedule_date = cast(o.start_ast as date))
      and o.record_id not in (select record_id from cand where rn = 1)
)
select * from scheduled
union all
select * from unscheduled
