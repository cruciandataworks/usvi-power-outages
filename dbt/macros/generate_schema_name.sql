{# Use the folder's schema name as is (staging, marts ...) instead of dbt's default
   "<target>_<schema>", so the tables are easy to find in DuckDB. #}
{% macro generate_schema_name(custom_schema_name, node) -%}
    {{ custom_schema_name if custom_schema_name else target.schema }}
{%- endmacro %}
