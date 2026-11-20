-- Every district-wide and major outage VI Update found (labeled/events.csv) must be in
-- our events table with the same start minute, end minute and peak - and we must not
-- find any they did not.
with ours as (
    select district, class, date_trunc('minute', start_ast) as start_min,
           date_trunc('minute', end_ast) as end_min, peak_out
    from {{ ref('mart_outage_events') }} where source = 'archive'
),
theirs as (
    select district, class, start_ast as start_min, end_ast as end_min, peak_out
    from {{ ref('stg_ref_events') }}
)
select coalesce(o.district, t.district) as district, coalesce(o.class, t.class) as class,
       t.start_min as vi_update_start, o.start_min as our_start,
       t.end_min as vi_update_end, o.end_min as our_end, t.peak_out as vi_update_peak, o.peak_out as our_peak
from ours o
full outer join theirs t using (district, class, start_min)
where o.district is null or t.district is null
   or o.end_min is distinct from t.end_min or o.peak_out is distinct from t.peak_out
