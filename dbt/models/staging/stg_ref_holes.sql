select kind, cast(start_ast as timestamp) as start_ast, cast(end_ast as timestamp) as end_ast,
       cast(hours as double) as hours, cause
from {{ source('raw', 'ref_holes') }}
