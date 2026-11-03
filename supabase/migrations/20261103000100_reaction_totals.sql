create function public.candle_reaction_totals(ticker text, candle_id integer)
returns table(emoji text, total bigint)
language sql stable security invoker set search_path = '' as $$
  select r.emoji, count(*)
  from public.reactions r
  where r.room = ticker and r.candle = candle_id
  group by r.emoji;
$$;
revoke execute on function public.candle_reaction_totals(text, integer) from public;
grant execute on function public.candle_reaction_totals(text, integer) to anon, authenticated;
