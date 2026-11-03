export const candles = Array.from({ length: 32 }, (_, index) => {
  const price = (i: number) => 55 + i * 1.22 + Math.sin(i * .57) * 9 + Math.cos(i * 2.1) * 3;
  const open = price(index);
  const close = price(index + 1);
  return { open, close, high: Math.max(open, close) + 3 + index % 4, low: Math.min(open, close) - 3 - index % 3 };
});
