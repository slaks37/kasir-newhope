import type { Order } from '../../types';

// This allowlist cannot replace monetary amounts, payment state or outlet scope.
export const ORDER_OPERATION_FIELDS = ['id','notes','laundryStatus','laundryStage','waNotifiedAt','storageRack',
  'carwashStage','vehiclePlate','vehicleModel','assignedCrew','completionDate','dropOffDate','completionEstimate',
  'tableId','tableName','customer','servedByStaffId','servedByStaffName','onlineChannel'] as const;
export function orderOperations(order:Order):Record<string,unknown> {
  return Object.fromEntries(ORDER_OPERATION_FIELDS.filter(key=>order[key]!==undefined).map(key=>[key,order[key]]));
}
export function mergeOrderOperations(order:Order,operations:Record<string,unknown>|undefined):Order {
  if(!operations)return order;
  return {...order,...Object.fromEntries(ORDER_OPERATION_FIELDS.filter(key=>key!=='id'&&operations[key]!==undefined).map(key=>[key,operations[key]]))};
}
