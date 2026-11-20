-- The archive's MISSING stretches must match VI Update's holes.csv exactly.
with ours as (
    select date_trunc('minute', start_ast) as s, date_trunc('minute', end_ast) as e
    from {{ ref('mart_gaps') }} where kind = 'MISSING' and source = 'archive'
),
theirs as (
    select start_ast as s, end_ast as e from {{ ref('stg_ref_holes') }} where kind = 'MISSING'
)
select * from (select *, 'only ours' as side from ours except select *, 'only ours' from theirs)
union all
select * from (select *, 'only VI Update' from theirs except select *, 'only VI Update' from ours)
