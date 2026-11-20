-- Conditions that need attention right now. Step 7 keeps one GitHub issue open per key
-- and closes it when the condition clears. Outage alerts only fire on a fresh live poll
-- (taken in the last 3 hours), so rebuilding old data never raises one.
with now_utc as (select cast(now() at time zone 'UTC' as timestamp) as t),
cur as (
    select c.* from {{ ref('mart_current') }} c, now_utc n
    where c.source = 'live' and c.is_usable and c.poll_utc >= n.t - interval 3 hour
),
outage as (
    select
        'outage:' || district                              as alert_key,
        'outage'                                           as category,
        case level when 'district-wide' then 'high' else 'medium' end as severity,
        district_name || ': ' || level || ' outage'        as title,
        'WAPA''s outage map shows ' || format('{:,}', customers_out) || ' customers out on '
            || district_name || ' (' || pct_of_reference || '% of the grid''s largest recorded outage, '
            || format('{:,}', reference_customers) || ' customers) at '
            || strftime(poll_ast, '%-d %b %Y %H:%M') || ' AST.' as message,
        poll_utc                                           as observed_at
    from cur where level in ('district-wide', 'major')
),
stale as (
    select 'stale:wapa_feed', 'data', 'low',
           'WAPA''s outage map has not updated for ' || cast(round(feed_lag_min / 60.0, 1) as varchar) || ' hours',
           'WAPA''s own update time was ' || strftime(wapa_update_utc - interval 4 hour, '%-d %b %H:%M')
               || ' AST at our latest poll. Polls while the map is stale are recorded but not counted.',
           poll_utc
    from {{ ref('mart_current') }}, now_utc n
    where source = 'live' and feed_lag_min >= {{ var('stale_alert_min') }} and poll_utc >= n.t - interval 3 hour
    qualify row_number() over () = 1
),
collector as (
    select 'collector:' || source, 'data', 'medium',
           'Cannot reach WAPA''s outage map',
           'The last ' || consecutive_failures || ' runs could not read WAPA''s outage map. Last error: '
               || coalesce(last_error, 'none recorded') || '. Last success: '
               || coalesce(strftime(last_success_utc, '%Y-%m-%d %H:%M UTC'), 'never') || '.',
           last_attempt_utc
    from {{ ref('stg_source_health') }}
    where source = 'wapa_map' and consecutive_failures >= {{ var('max_consecutive_failures') }}
)
select * from outage
union all select * from stale
union all select * from collector
