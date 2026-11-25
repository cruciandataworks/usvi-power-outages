-- One row per feeder: its record on WAPA's map since March 2026, plus the neighborhoods
-- WAPA's June 2024 Feeder Listing puts on it. Feeders that are in the listing but have
-- never appeared on the map as a whole feeder are kept, with zero outages.
with o as (
    select * from {{ ref('mart_feeder_outages') }}
),
stats as (
    select
        district, feeder,
        count(*)                                                    as outages,
        round(sum(hours), 1)                                        as hours_out,
        round(median(hours), 2)                                     as median_hours,
        round(max(hours), 1)                                        as longest_hours,
        max(max_customers_out)                                      as peak_customers,
        count(*) filter (where is_power_supply)                     as power_supply_outages,
        round(coalesce(sum(hours) filter (where is_power_supply), 0), 1) as power_supply_hours,
        count(*) filter (where cause_code = 'none given')           as no_cause_outages,
        max(start_ast)                                              as last_outage_ast,
        bool_or(on_map_now)                                         as out_now,
        count(*) filter (where start_ast >= (select max(start_ast) from o) - interval 30 day) as outages_last_30d
    from o group by all
),
listing as (
    select
        district, feeder, any_value(island) as island, count(*) as places,
        count(*) filter (where split <> 'whole') as shared_places,
        string_agg(place, '; ' order by place) as place_list
    from {{ ref('feeder_places') }} group by all
),
-- island for feeders not in the listing: where most of their map points fall
map_island as (
    select district, feeder, mode(island) as island
    from {{ ref('mart_records') }} where feeder is not null and island is not null group by all
),
f as (
    select district, feeder from stats union select district, feeder from listing
)
select
    f.district, f.feeder,
    coalesce(l.island, m.island, case f.district when 'STX' then 'St. Croix' end) as island,
    l.feeder is not null                                         as in_listing,
    coalesce(l.places, 0)                                        as places,
    coalesce(l.shared_places, 0)                                 as shared_places,
    l.place_list,
    coalesce(s.outages, 0)                                       as outages,
    coalesce(s.hours_out, 0)                                     as hours_out,
    s.median_hours, s.longest_hours, s.peak_customers,
    coalesce(s.power_supply_outages, 0)                          as power_supply_outages,
    coalesce(s.power_supply_hours, 0)                            as power_supply_hours,
    coalesce(s.no_cause_outages, 0)                              as no_cause_outages,
    s.last_outage_ast, coalesce(s.out_now, false)                as out_now,
    coalesce(s.outages_last_30d, 0)                              as outages_last_30d,
    -- fairness: this feeder's power-supply hours against the typical (median) feeder in
    -- its district that has had any. 1.0 = its fair share; 2.0 = twice the typical load.
    round(coalesce(s.power_supply_hours, 0) / nullif(median(s.power_supply_hours)
        filter (where s.power_supply_hours > 0) over (partition by f.district), 0), 2) as power_supply_vs_median
from f
left join stats s using (district, feeder)
left join listing l using (district, feeder)
left join map_island m using (district, feeder)
