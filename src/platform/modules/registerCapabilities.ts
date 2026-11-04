export const REGISTER_CAPABILITIES=['outlet_revenue.read','shift.open','shift.read','shift_history.read','shift.close','shift_variance.submit','shift_variance.approve','register.configure'] as const;
export type RegisterCapability=typeof REGISTER_CAPABILITIES[number];
/** Capabilities refine POS access; they never grant the reports entitlement. */
export function registerCapabilities(role:string):RegisterCapability[]{
 if(['OWNER','ADMIN'].includes(role))return [...REGISTER_CAPABILITIES];
 if(role==='MANAGER')return REGISTER_CAPABILITIES.filter(c=>c!=='register.configure');
 if(role==='CASHIER')return REGISTER_CAPABILITIES.filter(c=>!['register.configure','shift_variance.approve'].includes(c));
 if(role==='ACCOUNTANT')return ['outlet_revenue.read','shift.read','shift_history.read'];
 return [];
}
