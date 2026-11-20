-- One row per outage record per poll. Rule 2 of VI Update's district rules is applied
-- here: a map point south of 17.9 N is St. Croix, north of 18.2 N is St. Thomas-St. John.
select
    cast(replace(poll_utc, 'Z', '') as timestamp)   as poll_utc,
    record_id,
    wapa_name,
    name_district,
    feeder,
    lat, lng,
    case when lat < 17.9 then 'STX' when lat > 18.2 then 'STTJ' end as point_district,
    customers_out_now, customers_restored, customers_out_initially,
    verified,
    nullif(trim(cause), '')                         as cause,
    {{ wapa_time_utc('wapa_start_time') }}          as wapa_start_utc,
    {{ wapa_time_utc('wapa_end_time') }}            as wapa_end_utc,
    {{ wapa_time_utc('wapa_modified_time') }}       as wapa_modified_utc,
    n_streets,
    source
from {{ source('raw', 'sightings') }}
