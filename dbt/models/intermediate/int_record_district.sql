-- Which grid each outage record belongs to. Each sighting is placed by the first rule
-- that applies, and the record takes the district most of its sightings got:
--   1. the record name's prefix (T-C- or STX = St. Croix; T-T- or T-J- = St. Thomas-St. John)
--   2. the map point's latitude (below 17.9 N = St. Croix, above 18.2 N = St. Thomas-St. John)
--   3. the island of the Census subdivision the map point falls in (or is within 2 km of)
-- Rules 1 and 2 are VI Update's. Their rule 3 votes with street labels, which we do not
-- keep (they can carry people's names), so ours uses the Census areas instead.
with placed as (
    select
        s.record_id,
        coalesce(s.name_district, s.point_district, pp.island_district) as district,
        case when s.name_district is not null then 'name'
             when s.point_district is not null then 'latitude'
             when pp.island_district is not null then 'census area' end as placed_by
    from {{ ref('stg_sightings') }} s
    left join {{ ref('stg_point_places') }} pp using (lat, lng)
),
votes as (
    select record_id, district, count(*) as n, min(placed_by) as placed_by
    from placed where district is not null
    group by all
),
winner as (
    select record_id, district, placed_by, n,
           sum(n) over (partition by record_id) as placed_sightings
    from votes
    qualify row_number() over (partition by record_id order by n desc, district) = 1
)
select
    r.record_id,
    w.district,
    w.placed_by,
    w.n                       as sightings_agreeing,
    w.placed_sightings
from (select distinct record_id from {{ ref('stg_sightings') }}) r
left join winner w using (record_id)
