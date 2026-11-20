-- No poll may stand for more than 15 minutes, and no day for more than 24 hours.
select 'poll' as what, cast(poll_utc as varchar) as id, interval_min as value
from {{ ref('int_poll_status') }} where interval_min > {{ var('interval_cap_min') }} or interval_min < 0
union all
select 'day', cast(date_ast as varchar) || ' ' || district, covered_hours
from {{ ref('mart_outage_daily') }} where covered_hours > 24.0001
