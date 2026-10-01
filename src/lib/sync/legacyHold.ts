/** Durable review holds; neither competing copy nor the original queue is deleted. */
type HeldIds = { orders: string[]; cash_movements: string[] };
const key = (businessId:string) => `newhope_legacy_financial_holds_${businessId}`;
export function legacyFinancialHolds(businessId:string): HeldIds {
  const raw=localStorage.getItem(key(businessId));
  if(!raw)return {orders:[],cash_movements:[]};
  const value=JSON.parse(raw);
  if(!value || !['orders','cash_movements'].every(kind=>Array.isArray(value[kind]) &&
    value[kind].every((id:unknown)=>typeof id==='string')))
    throw new Error('LEGACY_REVIEW_HOLDS_INVALID');
  return value;
}
export function holdLegacyFinancialId(businessId:string,kind:keyof HeldIds,id:string):void {
  const held=legacyFinancialHolds(businessId);
  if(!held[kind].includes(id)){
    held[kind].push(id);
    // Must succeed before any migration copy can be sent.
    localStorage.setItem(key(businessId),JSON.stringify(held));
  }
}
