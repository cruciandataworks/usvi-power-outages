-- One row per poll of WAPA's summary. A poll is "usable" when WAPA's data was fresh
-- (updated within 30 minutes of the poll) and the outage records were saved too.
-- Only usable polls are ever summed; stale or partial time is never counted as zero.
with p as (
    select
        cast(replace(poll_utc, 'Z', '') as timestamp)        as poll_utc,
        {{ wapa_time_utc('wapa_update_time') }}               as wapa_update_utc,
        customers_served, out_territory, customers_affected, customers_restored,
        coalesce(outages_captured, false)                     as outages_captured,
        active_outage_records, streets_affected, source
    from {{ source('raw', 'polls') }}
)
select
    *,
    {{ to_ast('poll_utc') }}                                   as poll_ast,
    round(date_diff('millisecond', wapa_update_utc, poll_utc) / 60000.0, 1) as feed_lag_min,
    (wapa_update_utc is null
     or date_diff('millisecond', wapa_update_utc, poll_utc) / 60000.0 > {{ var('stale_after_min') }}) as is_stale
from p
