select record_id, district from {{ source('raw', 'ref_records') }}
