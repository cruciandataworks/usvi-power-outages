-- The usable polls in long form, one row per poll and grid, with the poll's time split
-- at midnight AST (an interval from 23:55 to 00:05 counts 5 minutes on each day).
with usable as (
    select poll_utc, poll_ast, source, interval_min, 'STX' as district, out_stx as customers_out
    from {{ ref('int_poll_status') }} where is_usable
    union all
    select poll_utc, poll_ast, source, interval_min, 'STTJ', out_sttj
    from {{ ref('int_poll_status') }} where is_usable
),
spans as (
    select *,
        poll_ast + to_milliseconds(cast(round(interval_min * 60000) as bigint)) as end_ast,
        date_trunc('day', poll_ast) + interval 1 day                              as next_midnight
    from usable
)
select poll_utc, poll_ast, source, district, customers_out, cast(poll_ast as date) as date_ast,
       date_diff('millisecond', poll_ast, least(end_ast, next_midnight)) / 3600000.0 as hours
from spans
union all
select poll_utc, poll_ast, source, district, customers_out, cast(next_midnight as date),
       date_diff('millisecond', next_midnight, end_ast) / 3600000.0
from spans where end_ast > next_midnight
