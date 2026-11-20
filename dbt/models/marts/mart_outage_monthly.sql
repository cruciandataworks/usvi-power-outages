select
    date_trunc('month', date_ast)::date              as month,
    district,
    count(*)                                         as days_with_data,
    round(sum(covered_hours), 1)                     as covered_hours,
    round(sum(covered_hours) / (24.0 * (date_diff('day', date_trunc('month', min(date_ast)),
          date_trunc('month', min(date_ast)) + interval 1 month))), 3) as share_of_month_covered,
    round(sum(customer_hours), 0)                    as customer_hours,
    max(max_out)                                     as max_out,
    round(sum(hours_over_1000), 1)                   as hours_over_1000,
    count(*) filter (where day_over_25pct)           as days_over_25pct,
    count(*) filter (where day_over_80pct)           as days_over_80pct,
    round(sum(hours_per_customer), 2)                as hours_per_customer
from {{ ref('mart_outage_daily') }}
group by all
