-- One row per distinct schedule PDF we have downloaded (identified by its SHA-256).
select
    sha256, url,
    cast(replace(first_seen_utc, 'Z', '') as timestamp) as first_seen_utc,
    cast(replace(last_seen_utc, 'Z', '') as timestamp)  as last_seen_utc,
    bytes, districts, schedule_dates, windows, parse_error, original_saved_as
from {{ source('raw', 'schedule_versions') }}
