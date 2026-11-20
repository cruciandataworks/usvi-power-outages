-- Our daily table, rebuilt from the raw polls, against VI Update's published one
-- (labeled/daily.csv), day by day for the archive period. A day "differs" when
-- customer-hours are off by more than 0.5%, covered hours by more than 0.01, or the
-- peak is not identical.
-- Two days are known to differ: 17 and 18 April on St. Croix, where three recloser
-- records (REC-9B-1A-LLOV) sit offshore and VI Update placed them with street labels,
-- which we do not keep. More than 2 days differing is a warning; more than 5 is an error.
{{ config(warn_if='>2', error_if='>5') }}
select r.date_ast, r.district,
       r.customer_hours as vi_update_customer_hours, o.customer_hours,
       r.covered_hours  as vi_update_covered_hours,  o.covered_hours,
       r.max_out        as vi_update_max_out,        o.max_out
from {{ ref('stg_ref_daily') }} r
left join {{ ref('mart_outage_daily') }} o using (date_ast, district)
where o.date_ast is null
   or abs(o.customer_hours - r.customer_hours) > greatest(1, 0.005 * r.customer_hours)
   or abs(o.covered_hours - r.covered_hours) > 0.01
   or o.max_out is distinct from r.max_out
