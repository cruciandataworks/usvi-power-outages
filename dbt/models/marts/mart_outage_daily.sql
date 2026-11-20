-- One row per grid per day (AST): VI Update's daily table, rebuilt from the raw polls.
--   covered_hours    hours of usable polls (a day with gaps covers fewer than 24)
--   customer_hours   customers out x hours, summed: one customer without power for one
--                    hour is one customer-hour
--   max_out          the most customers out at any usable poll that day
--   hours_per_customer  customer_hours / the grid's reference size: roughly how many
--                    hours the average customer was out (a proxy, not the IEEE SAIDI index)
with d as (
    select date_ast, district,
           sum(hours)                                                      as covered_hours,
           sum(customers_out * hours)                                      as customer_hours,
           sum(case when customers_out >= 1000 then hours else 0 end)      as hours_over_1000,
           max(source)                                                     as source
    from {{ ref('int_poll_district') }}
    group by all
),
peak as (
    select cast(poll_ast as date) as date_ast, district, max(customers_out) as max_out
    from {{ ref('int_poll_district') }}
    group by all
)
select
    d.date_ast, d.district, d.source,
    round(d.covered_hours, 2)                                   as covered_hours,
    round(d.customer_hours, 0)                                  as customer_hours,
    p.max_out,
    round(d.hours_over_1000, 2)                                 as hours_over_1000,
    coalesce(p.max_out >= 0.25 * r.reference_customers, false)  as day_over_25pct,
    coalesce(p.max_out >= 0.80 * r.reference_customers, false)  as day_over_80pct,
    round(d.customer_hours / r.reference_customers, 3)          as hours_per_customer
from d
left join peak p using (date_ast, district)
join {{ ref('district_reference') }} r using (district)
