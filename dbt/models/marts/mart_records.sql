-- One row per WAPA outage record (an outage as WAPA's map listed it), summarized from
-- its sightings. life_hours runs from WAPA's start time to the last poll that showed it:
-- when the map cleared it, which is not necessarily when power came back.
with s as (
    select * from {{ ref('stg_sightings') }}
),
agg as (
    select
        record_id,
        min(source)                                   as source,
        arg_max(wapa_name, poll_utc)                  as wapa_name,
        max(feeder)                                   as feeder,
        arg_max(lat, poll_utc)                        as lat,
        arg_max(lng, poll_utc)                        as lng,
        min(poll_utc)                                 as first_seen_utc,
        max(poll_utc)                                 as last_seen_utc,
        count(*)                                      as sightings,
        arg_max(wapa_start_utc, poll_utc)             as wapa_start_utc,
        arg_min(wapa_start_utc, poll_utc)             as wapa_start_first_published_utc,
        max(wapa_end_utc)                             as wapa_end_utc,
        max(customers_out_initially)                  as customers_out_initially,
        max(customers_out_now)                        as max_customers_out,
        max(customers_restored)                       as max_customers_restored,
        arg_max(cause, poll_utc) filter (where cause is not null) as cause,
        bool_or(verified)                             as ever_verified
    from s group by record_id
),
latest as (
    select max(poll_utc) as latest_poll_utc from {{ ref('int_poll_status') }} where outages_captured
)
select
    a.record_id, d.district, d.placed_by as district_placed_by,
    case when pp.island_district = d.district then pp.subdivision end as subdivision,
    case when pp.island_district = d.district then pp.island end      as island,
    a.wapa_name, a.feeder, a.source, a.lat, a.lng,
    a.wapa_start_utc, {{ to_ast('a.wapa_start_utc') }} as wapa_start_ast,
    a.wapa_start_first_published_utc, a.wapa_end_utc,
    a.first_seen_utc, a.last_seen_utc, a.sightings,
    a.customers_out_initially, a.max_customers_out, a.max_customers_restored,
    a.cause, coalesce(left(a.cause, 3), 'none given') as cause_code, a.ever_verified,
    round(date_diff('second', a.wapa_start_utc, a.first_seen_utc) / 60.0, 1) as posting_delay_min,
    round(date_diff('second', a.wapa_start_utc, a.last_seen_utc) / 3600.0, 2) as life_hours,
    a.last_seen_utc = l.latest_poll_utc as on_map_now
from agg a
cross join latest l
left join {{ ref('int_record_district') }} d using (record_id)
left join {{ ref('stg_point_places') }} pp on pp.lat = a.lat and pp.lng = a.lng
