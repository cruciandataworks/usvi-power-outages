-- The newest poll: how many customers each grid has out right now, by WAPA's map.
with latest as (
    select * from {{ ref('int_poll_status') }}
    where outages_captured
    qualify row_number() over (order by poll_utc desc) = 1
)
select
    l.poll_utc, l.poll_ast, l.source, l.wapa_update_utc, l.feed_lag_min, l.is_stale, l.is_usable,
    l.customers_served, l.out_territory, l.records_on_map, l.out_unplaced,
    r.district, r.district_name, r.reference_customers,
    case r.district when 'STX' then l.out_stx else l.out_sttj end as customers_out,
    round(100.0 * (case r.district when 'STX' then l.out_stx else l.out_sttj end) / r.reference_customers, 1) as pct_of_reference,
    case when (case r.district when 'STX' then l.out_stx else l.out_sttj end) >= 0.80 * r.reference_customers then 'district-wide'
         when (case r.district when 'STX' then l.out_stx else l.out_sttj end) >= 0.25 * r.reference_customers then 'major'
         when (case r.district when 'STX' then l.out_stx else l.out_sttj end) >= 1000 then 'large'
         else 'normal' end as level
from latest l
cross join {{ ref('district_reference') }} r
