-- Customer-hours by Census county subdivision and month. Each sighting's customers out
-- x its poll's interval go to the subdivision its own map point falls in, provided that
-- subdivision is on the record's grid (otherwise "unplaced").
select
    date_trunc('month', p.poll_ast)::date                        as month,
    d.district,
    case when pp.island_district = d.district then pp.island      else 'Unplaced' end as island,
    case when pp.island_district = d.district then pp.subdivision else 'Unplaced' end as subdivision,
    round(sum(s.customers_out_now * p.interval_min / 60.0), 0)    as customer_hours,
    count(distinct s.record_id)                                   as records
from {{ ref('stg_sightings') }} s
join {{ ref('int_poll_status') }} p using (poll_utc)
left join {{ ref('int_record_district') }} d using (record_id)
left join {{ ref('stg_point_places') }} pp using (lat, lng)
where p.is_usable and d.district is not null
group by all
