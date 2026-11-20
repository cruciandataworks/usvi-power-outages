select
    lat, lng, subdivision, island, geoid, km_outside, placed_by,
    case island when 'St. Croix' then 'STX' when 'St. Thomas' then 'STTJ' when 'St. John' then 'STTJ' end as island_district
from {{ source('raw', 'point_places') }}
