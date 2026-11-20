-- Warn if our newest live poll is more than 6 hours old: the schedule has stopped, or
-- every recent poll failed. (A warning, so rebuilding old data on a laptop still works.)
{{ config(severity='warn') }}
select max(poll_utc) as latest_live_poll
from {{ ref('stg_polls') }} where source = 'live'
having max(poll_utc) is null
    or max(poll_utc) < cast(now() at time zone 'UTC' as timestamp) - interval 6 hour
