export function durationToRouterTime(value) {
  const text = String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const amount = Number(text.match(/\d+/)?.[0] || 0);

  if (!amount) return '';
  if (text.includes('hora')) return `${amount}h`;
  if (text.includes('dia')) return `${amount}d`;
  if (text.includes('semana')) return `${amount}w`;

  return '';
}
