select district, class, cast(start_ast as timestamp) as start_ast, cast(end_ast as timestamp) as end_ast,
       cast(peak_out as int) as peak_out, ends_by, starts_by
from {{ source('raw', 'ref_events') }}
