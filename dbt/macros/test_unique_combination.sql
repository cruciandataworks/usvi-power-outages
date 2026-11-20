{# Fails on any combination of the columns that appears more than once (a small
   stand-in for dbt_utils.unique_combination_of_columns, so the project needs no packages). #}
{% test unique_combination(model, columns) %}
select {{ columns | join(', ') }}, count(*) as n
from {{ model }}
group by {{ columns | join(', ') }}
having count(*) > 1
{% endtest %}
