-- At least 99.9% of the archive's records must land in the same grid as VI Update put
-- them (7,430 of 7,433 do; the three that do not are left unplaced, never misplaced).
with cmp as (
    select count(*) as n,
           count(*) filter (where o.district = r.district) as agree,
           count(*) filter (where o.district is not null and o.district <> r.district) as misplaced
    from {{ ref('stg_ref_records') }} r
    left join {{ ref('int_record_district') }} o using (record_id)
)
select * from cmp where agree < 0.999 * n or misplaced > 0
