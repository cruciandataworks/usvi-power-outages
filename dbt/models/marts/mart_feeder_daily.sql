-- One row per feeder per AST day on which it was out: how many outages began that day
-- and how many hours it was out that day. An outage that runs past midnight is split
-- across the days it covers, so a day never has more than 24 hours.
with o as (
    select * from {{ ref('mart_feeder_outages') }}
),
days as (
    select o.*, unnest(generate_series(cast(start_ast as date), cast(end_ast as date), interval 1 day)) as d
    from o
),
split as (
    select
        district, feeder, cast(d as date) as date_ast, record_id, is_power_supply, max_customers_out,
        cast(start_ast as date) = cast(d as date) as started_today,
        greatest(0, date_diff('second',
            greatest(start_ast, cast(d as timestamp)),
            least(end_ast, cast(d as timestamp) + interval 1 day))) / 3600.0 as h
    from days
)
select
    district, feeder, date_ast,
    count(*) filter (where started_today)                         as outages_started,
    round(sum(h), 2)                                              as hours_out,
    round(sum(h) filter (where is_power_supply), 2)               as power_supply_hours,
    bool_or(is_power_supply)                                      as any_power_supply,
    max(max_customers_out)                                        as max_customers_out
from split
group by all
having sum(h) > 0 or count(*) filter (where started_today) > 0
