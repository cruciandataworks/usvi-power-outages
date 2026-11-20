select cast(date_ast as date) as date_ast, district,
       cast(covered_hours as double) as covered_hours, cast(customer_hours as double) as customer_hours,
       cast(max_out as int) as max_out, cast(hours_over_1000 as double) as hours_over_1000
from {{ source('raw', 'ref_daily') }}
