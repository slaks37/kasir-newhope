/** Calendar date in the business timezone, independent of browser/server timezone. */
export function calendarDate(zone='Asia/Jakarta',offsetDays=0,now=new Date()):string{
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
 const part=(type:string)=>parts.find(p=>p.type===type)?.value;
 const date=new Date(`${part('year')}-${part('month')}-${part('day')}T12:00:00Z`);date.setUTCDate(date.getUTCDate()+offsetDays);
 return date.toISOString().slice(0,10);
}
