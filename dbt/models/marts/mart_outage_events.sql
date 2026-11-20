-- District-wide (80% or more of the grid's reference size) and major (25% or more)
-- outages, by VI Update's rule (rules/events.md):
--   * an event is a run of usable polls at or above the threshold
--   * a run never crosses an unusable poll or more than 15 minutes between polls
--   * two runs merge across a dip below the threshold shorter than 30 minutes
--   * it ends at the first usable poll back below the threshold ("observed_drop"); if a
--     gap comes first, the true end was not seen ("gap")
with thresholds as (
    select district, district_name, reference_customers, 'districtwide_80pct' as class, 0.80 * reference_customers as threshold
    from {{ ref('district_reference') }}
    union all
    select district, district_name, reference_customers, 'major_25pct', 0.25 * reference_customers
    from {{ ref('district_reference') }}
),
polls as (
    select *,
        lag(is_usable) over (partition by source order by poll_utc) as prev_usable,
        max(poll_utc) over (partition by source)                     as last_poll_utc,
        min(poll_utc) over (partition by source)                     as first_poll_utc
    from {{ ref('int_poll_status') }}
),
segments as (   -- unbroken stretches of usable polls, no more than 15 minutes apart
    select *,
        sum(case when not is_usable or prev_usable is distinct from true
                      or min_since_prev is null
                      or min_since_prev > {{ var('interval_cap_min') }} then 1 else 0 end)
            over (order by poll_utc) as seg_id
    from polls
),
flagged as (
    select s.poll_utc, s.poll_ast, s.source, s.seg_id, s.interval_min, s.next_poll_utc,
           s.poll_utc = s.first_poll_utc as is_first_poll, s.poll_utc = s.last_poll_utc as is_last_poll,
           t.district, t.district_name, t.class, t.threshold, t.reference_customers,
           case t.district when 'STX' then s.out_stx else s.out_sttj end as customers_out
    from segments s cross join thresholds t
    where s.is_usable
),
flagged2 as (
    select *,
        customers_out >= threshold as above,
        lag(customers_out >= threshold) over w  as prev_above,
        lag(poll_ast) over w                    as prev_in_seg,
        lead(poll_ast) over w                   as next_in_seg
    from flagged
    window w as (partition by district, class, seg_id order by poll_utc)
),
runs0 as (
    select *, sum(case when above and prev_above is distinct from true then 1 else 0 end)
                  over (partition by district, class, seg_id order by poll_utc) as run_no
    from flagged2
),
runs as (   -- (the _null versions keep a NULL "no poll before/after" instead of skipping it)
    select district, class, seg_id, run_no,
           min(poll_ast) as first_ast, max(poll_ast) as last_ast,
           arg_min_null(prev_in_seg, poll_utc)   as poll_before_start,
           arg_min(is_first_poll, poll_utc) as starts_at_capture_start,
           arg_max_null(next_in_seg, poll_utc)   as drop_ast,
           arg_max(interval_min, poll_utc)  as last_interval_min,
           arg_max(is_last_poll, poll_utc)  as ends_at_last_poll,
           sum(interval_min) / 60.0         as hours_above
    from runs0 where above
    group by all
),
merged as (
    select *,
        coalesce(lag(lead_merges) over (partition by district, class, seg_id order by run_no), false) as continues_previous
    from (
        select *,
            coalesce(lead(first_ast) over (partition by district, class, seg_id order by run_no) - drop_ast
                     < interval {{ var('dip_merge_min') }} minute, false) as lead_merges
        from runs
    )
),
grouped as (
    select *, sum(case when continues_previous then 0 else 1 end)
                  over (partition by district, class, seg_id order by run_no) as event_no
    from merged
),
events as (
    select district, class, seg_id, event_no,
           min(first_ast)                      as start_ast,
           arg_max(last_ast, run_no)           as last_above_ast,
           arg_max_null(drop_ast, run_no)           as drop_ast,
           arg_max(last_interval_min, run_no)  as last_interval_min,
           arg_max(ends_at_last_poll, run_no)  as ends_at_last_poll,
           arg_min_null(poll_before_start, run_no)  as poll_before_start,
           arg_min(starts_at_capture_start, run_no) as starts_at_capture_start,
           count(*) - 1                        as merged_dips,
           sum(hours_above)                    as observed_hours_above
    from grouped group by all
),
bounded as (
    select e.*,
        case when drop_ast is not null then drop_ast
             when ends_at_last_poll then last_above_ast
             else last_above_ast + to_milliseconds(cast(round(last_interval_min * 60000) as bigint)) end as end_ast,
        case when drop_ast is not null then 'observed_drop'
             when ends_at_last_poll then 'capture_end' else 'gap' end as ends_by,
        case when poll_before_start is not null then 'observed_rise'
             when starts_at_capture_start then 'capture_start' else 'gap' end as starts_by
    from events e
)
select
    b.district, f.district_name, b.class,
    b.start_ast, b.end_ast,
    round(date_diff('second', b.start_ast, b.end_ast) / 3600.0, 2)   as wall_span_hours,
    round(b.observed_hours_above, 2)                                  as observed_hours_above,
    b.merged_dips, b.starts_by, b.ends_by,
    max(f.customers_out)                                              as peak_out,
    round(100.0 * max(f.customers_out) / max(f.reference_customers)) as peak_pct_district,
    round(sum(f.customers_out * f.interval_min / 60.0))               as customer_hours_wall_span,
    max(f.source)                                                     as source,
    bool_or(b.ends_by = 'capture_end' and f.source = 'live')          as is_ongoing
from bounded b
join flagged f
  on f.district = b.district and f.class = b.class and f.seg_id = b.seg_id
 and f.poll_ast >= b.start_ast and f.poll_ast < greatest(b.end_ast, b.start_ast + interval 1 second)
group by b.district, f.district_name, b.class, b.start_ast, b.end_ast, b.observed_hours_above,
         b.merged_dips, b.starts_by, b.ends_by
