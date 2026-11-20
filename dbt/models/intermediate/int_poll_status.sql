-- One row per poll: was it usable, how many customers were out in each grid, and how
-- much time it stands for (the minutes to the next poll, capped at 15; nothing after the
-- last poll). The district totals add up the records on the map at that poll.
with totals as (
    select
        s.poll_utc,
        sum(case when r.district = 'STX'  then s.customers_out_now else 0 end) as out_stx,
        sum(case when r.district = 'STTJ' then s.customers_out_now else 0 end) as out_sttj,
        sum(case when r.district is null  then s.customers_out_now else 0 end) as out_unplaced,
        count(*) as records_on_map
    from {{ ref('stg_sightings') }} s
    left join {{ ref('int_record_district') }} r using (record_id)
    group by s.poll_utc
),
p as (
    select
        p.poll_utc, p.poll_ast, p.source, p.wapa_update_utc, p.feed_lag_min, p.is_stale,
        p.outages_captured, p.customers_served, p.out_territory,
        (not p.is_stale and p.outages_captured)                         as is_usable,
        -- VI Update's capture and ours are separate captures: the last poll of each stands
        -- for nothing after it, and the 13-day gap between them is never bridged
        lead(p.poll_utc) over (partition by p.source order by p.poll_utc) as next_poll_utc,
        date_diff('millisecond', lag(p.poll_utc) over (partition by p.source order by p.poll_utc), p.poll_utc) / 60000.0 as min_since_prev,
        -- a poll with no records on the map had nobody out
        case when p.outages_captured then coalesce(t.out_stx, 0) end      as out_stx,
        case when p.outages_captured then coalesce(t.out_sttj, 0) end     as out_sttj,
        case when p.outages_captured then coalesce(t.out_unplaced, 0) end as out_unplaced,
        case when p.outages_captured then coalesce(t.records_on_map, 0) end as records_on_map
    from {{ ref('stg_polls') }} p
    left join totals t using (poll_utc)
)
select
    *,
    -- (DuckDB's least() skips NULLs, so the last poll needs its own case)
    case when next_poll_utc is null then 0
         else least(date_diff('millisecond', poll_utc, next_poll_utc) / 60000.0,
                    {{ var('interval_cap_min') }}) end            as interval_min
from p
