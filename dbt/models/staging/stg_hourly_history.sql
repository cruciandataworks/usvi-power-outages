-- WAPA's own count of customers out across the territory, one value per hour (AST).
-- Each summary carries the last 48 hours, so an hour is seen many times; we keep the
-- final value. Archive hours come from VI Update; live hours from our polls.
select
    cast(left(event_hour_ast, 19) as timestamp)  as hour_ast,
    final_value                                  as customers_out,
    first_value                                  as first_value,
    case when first_value is null then 'live' else 'archive' end as source
from {{ source('raw', 'hourly_history') }}
qualify row_number() over (partition by cast(left(event_hour_ast, 19) as timestamp)
                           order by case when first_value is null then 0 else 1 end) = 1
