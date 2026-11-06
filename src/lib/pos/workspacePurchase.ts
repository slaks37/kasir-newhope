import type {BusinessSector} from '../../types';
/** Exact command bound by a separate server financial approval for each module. */
export function sharedPurchaseCashCommand(commandId:string,moduleId:string,outletId:string,sector:BusinessSector,amount:number,occurredAt:string,description:string){
 return {sector,outletId,clientEventId:`purchase:${commandId}:${moduleId}`,type:'CASH_OUT' as const,amount,occurredAt,description,category:'BELANJA_BAHAN',recipientOrSource:'Shared purchase '+commandId};
}
