-- WAPA's own territory-wide customers-out count by hour. Independent of our polls, so it
-- also covers hours our record missed (it reaches back 48 hours from each poll).
select hour_ast, customers_out, source
from {{ ref('stg_hourly_history') }}
