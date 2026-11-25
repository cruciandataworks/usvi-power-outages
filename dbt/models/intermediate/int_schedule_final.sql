-- WAPA may post several versions of a day's schedule. We compare outages with the last
-- version we saved for that day (the plan as it finally stood), and keep how many
-- versions there were.
with versions as (
    select district, schedule_date, sha256, min(version_seen_utc) as seen_utc
    from {{ ref('stg_schedule_windows') }}
    group by all
),
ranked as (
    select *,
        row_number() over (partition by district, schedule_date order by seen_utc desc) as rn,
        count(*)     over (partition by district, schedule_date)                        as versions_of_day
    from versions
)
select
    w.district, w.schedule_date, w.window_label, w.window_start_ast, w.window_end_ast,
    w.feeder, w.partial, w.area, r.versions_of_day, r.seen_utc as version_seen_utc, w.sha256
from {{ ref('stg_schedule_windows') }} w
join ranked r using (district, schedule_date, sha256)
where r.rn = 1
qualify row_number() over (partition by w.district, w.window_start_ast, w.feeder order by w.page) = 1
