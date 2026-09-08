import { fail } from './common.js';
const day=86400000;
export function dateRange(query={}, now=new Date()) {
  const local=new Date(now.getTime()+2*3600000);
  const today=local.toISOString().slice(0,10);
  let from=query.from, to=query.to;
  const start=new Date(today+'T00:00:00Z');
  const iso=d=>d.toISOString().slice(0,10);
  if(!from&&!to) {
    to=today;
    switch(query.period||'month') {
      case 'today': from=today;break;
      case 'yesterday': from=to=iso(new Date(+start-day));break;
      case 'week': from=iso(new Date(+start-((start.getUTCDay()+6)%7)*day));break;
      case 'month': from=today.slice(0,7)+'-01';break;
      case 'previous-month': from=iso(new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()-1,1)));to=iso(new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),0)));break;
      case 'year':from=today.slice(0,4)+'-01-01';break;
      default:fail(422,'Período inválido.');
    }
  }
  for(const date of [from,to]) if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||iso(new Date(date))!==date) fail(422,'Datas inválidas.');
  if(from>to || Date.parse(to)-Date.parse(from)>366*day) fail(422,'Use um período até 367 dias, com início anterior ao fim.');
  return {from,to,start:from+' 00:00:00',end:iso(new Date(Date.parse(to)+day))+' 00:00:00',timeZone:'Africa/Maputo'};
}
// Existing DATETIME columns use the database server's wall clock. Never change
// the public pool timezone. ADMIN_DB_TIME_ZONE must match that historic clock.
export function maputoColumn(column) {
  const zone=process.env.ADMIN_DB_TIME_ZONE||'+00:00';
  if(!/^[+-](0\d|1[0-4]):[0-5]\d$/.test(zone)) fail(503,'Configure ADMIN_DB_TIME_ZONE.');
  return `CONVERT_TZ(${column},'${zone}','+02:00')`;
}
