select
    source,
    cast(left(last_attempt, 19) as timestamp)  as last_attempt_utc,
    cast(left(last_success, 19) as timestamp)  as last_success_utc,
    coalesce(consecutive_failures, 0)          as consecutive_failures,
    nullif(last_error, '')                     as last_error
from {{ source('raw', 'source_health') }}
