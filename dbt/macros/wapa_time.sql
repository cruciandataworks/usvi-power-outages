{# WAPA's times carry their own offset, e.g. 2026-11-20T00:00:42.3781399-04:00.
   Read the local clock time, then subtract the offset to get UTC (a plain timestamp). #}
{% macro wapa_time_utc(col) -%}
    case when {{ col }} is null or {{ col }} = '' then null
         when right({{ col }}, 1) = 'Z' then cast(left({{ col }}, 19) as timestamp)
         else cast(left({{ col }}, 19) as timestamp)
              - to_minutes(cast(substr(right({{ col }}, 6), 1, 1) || '1' as int)
                           * (cast(substr(right({{ col }}, 6), 2, 2) as int) * 60
                              + cast(substr(right({{ col }}, 6), 5, 2) as int)))
    end
{%- endmacro %}

{# The U.S. Virgin Islands keep Atlantic Standard Time (UTC-4) all year. #}
{% macro to_ast(col) -%}
    ({{ col }} - interval 4 hour)
{%- endmacro %}
