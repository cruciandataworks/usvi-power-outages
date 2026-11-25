-- One row per outage of a whole feeder on WAPA's map ("Feeder 07C", "STX Feeder 09B").
--
-- start: WAPA's own start time. A handful of records were already on the map when the
--        record began (one 7C outage says it started on 17 February); those are counted
--        from the first poll of the record, so they cannot add hours nobody observed.
-- end:   the last poll that still showed it - when the map cleared it, which is not
--        necessarily the minute power came back.
-- is_power_supply: WAPA's cause code 000 "Power supply", i.e. not enough generation.
--        That is what a rotating (load-shedding) outage is.
with r as (
    select * from {{ ref('mart_records') }} where feeder is not null
),
record_start as (
    select min(poll_utc) as utc from {{ ref('stg_polls') }}
),
o as (
    select
        r.record_id, r.district, r.feeder, r.source, r.cause, r.cause_code,
        r.cause_code = '000'                                               as is_power_supply,
        greatest(coalesce(r.wapa_start_utc, r.first_seen_utc), s.utc)     as start_utc,
        r.last_seen_utc                                                    as end_utc,
        coalesce(r.wapa_start_utc, r.first_seen_utc) < s.utc               as started_before_record,
        r.max_customers_out, r.customers_out_initially, r.on_map_now
    from r cross join record_start s
)
select
    o.*,
    {{ to_ast('o.start_utc') }}                                                as start_ast,
    {{ to_ast('o.end_utc') }}                                                  as end_ast,
    round(greatest(0, date_diff('second', o.start_utc, o.end_utc)) / 3600.0, 2) as hours
from o
