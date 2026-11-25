-- One row per (schedule version, window, feeder) from WAPA's rotation-schedule PDFs, as
-- saved and read by step 2b. Times in the PDF are AST wall-clock times.
select
    sha256,
    cast(replace(first_seen_utc, 'Z', '') as timestamp) as version_seen_utc,
    page,
    district,
    cast(schedule_date as date)                         as schedule_date,
    window_label,
    cast(window_start_ast as timestamp)                 as window_start_ast,
    cast(window_end_ast as timestamp)                   as window_end_ast,
    upper(feeder)                                       as feeder,
    partial,
    area
from {{ source('raw', 'schedule_windows') }}
