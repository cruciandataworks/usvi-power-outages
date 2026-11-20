select
    cast(replace(poll_utc, 'Z', '') as timestamp) as poll_utc,
    endpoint, ok, ms, error
from {{ source('raw', 'poll_log') }}
