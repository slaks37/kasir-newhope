import {useMemo,useState} from 'react';
import type {AttendanceRecord,GeoLocationInfo,PayrollSlip,StaffCommissionRule,StaffMember,StoreBranch} from '../../types';
import type {DomainLoader} from './useCatalogState';
import {belongsToBusiness,stampBusiness,type TenantInfo} from '../TenantContext';
import {newId} from '../../lib/ids';

type Options={tenant:Pick<TenantInfo,'businessId'|'sector'>;free:boolean;load:DomainLoader;loadRoster:()=>StaffMember[];
  outlet:()=>StoreBranch|undefined;sound:(kind:'click'|'delete')=>void};
/** Labor state is separate from cart/catalog and server financial state. Roster
 * is account-wide, but mutations and attendance are checked against the selected
 * business and outlet. Payroll cash disbursement stays in the financial domain. */
export function useLaborState(options:Options){
  const {tenant}=options;
  const [staffMembers,setStaffMembers]=useState(options.loadRoster);
  const [attendanceLogs,setAttendanceLogs]=useState<AttendanceRecord[]>(()=>options.load('attendance_logs',[]));
  const [commissionRules,setCommissionRules]=useState<StaffCommissionRule[]>(()=>options.load('commission_rules',[]));
  const [payrollSlips,setPayrollSlips]=useState<PayrollSlip[]>(()=>options.load('payroll_slips',[]));
  const sectorStaffMembers=useMemo(()=>staffMembers.filter(row=>belongsToBusiness(row,tenant)),[staffMembers,tenant.businessId,tenant.sector]);
  const staffFor=(id:string)=>{
    const staff=staffMembers.find(row=>row.id===id);
    if(staff&&!belongsToBusiness(staff,tenant))throw Error('STAFF_NOT_IN_SELECTED_BUSINESS');
    return staff;
  };
  const addStaffMember=(staff:Omit<StaffMember,'id'>)=>{
    if(options.free)throw Error('FREE_OWNER_ONLY');
    const row=stampBusiness({...staff,id:newId('stf')},tenant);
    setStaffMembers(previous=>[row,...previous]);options.sound('click');
  };
  const updateStaffMember=(staff:StaffMember)=>{
    if(!staffFor(staff.id))return;
    if(!belongsToBusiness(staff,tenant))throw Error('STAFF_NOT_IN_SELECTED_BUSINESS');
    setStaffMembers(previous=>previous.map(row=>row.id===staff.id?stampBusiness({...row,...staff},tenant):row));options.sound('click');
  };
  const deleteStaffMember=(id:string)=>{if(!staffFor(id))return;setStaffMembers(previous=>previous.filter(row=>row.id!==id));options.sound('delete');};
  const toggleStaffAvailability=(id:string)=>{if(!staffFor(id))return;setStaffMembers(previous=>previous.map(row=>row.id===id?{...row,isAvailable:!row.isAvailable}:row));options.sound('click');};
  const attendanceOutlet=(requested?:{id:string;name:string})=>{
    const outlet=options.outlet();
    if(!outlet?.isActive||requested&&requested.id!==outlet.id)throw Error('ATTENDANCE_OUTLET_NOT_SELECTED');
    return outlet;
  };
  const clockInStaff=(staffId:string,notes?:string,geoInfo?:GeoLocationInfo,branchInfo?:{id:string;name:string},photoUrl?:string)=>{
    const staff=staffFor(staffId);if(!staff)return;
    const outlet=attendanceOutlet(branchInfo);
    if(attendanceLogs.some(row=>row.staffId===staffId&&row.status==='CLOCKED_IN'))return;
    const row:AttendanceRecord={id:newId('att'),staffId,staffName:staff.name,staffRole:staff.role,clockInTime:new Date().toISOString(),
      shiftNotes:notes,status:'CLOCKED_IN',branchId:outlet.id,branchName:outlet.name,clockInGeo:geoInfo,businessSector:tenant.sector,photoUrl};
    setAttendanceLogs(previous=>[row,...previous]);options.sound('click');
  };
  const clockOutStaff=(staffId:string,notes?:string,geoInfo?:GeoLocationInfo,branchInfo?:{id:string;name:string})=>{
    if(!staffFor(staffId))return;const outlet=attendanceOutlet(branchInfo);
    setAttendanceLogs(previous=>previous.map(row=>row.staffId===staffId&&row.status==='CLOCKED_IN'?{...row,
      clockOutTime:new Date().toISOString(),shiftNotes:notes||row.shiftNotes,status:'CLOCKED_OUT',clockOutGeo:geoInfo,
      branchId:row.branchId||outlet.id,branchName:row.branchName||outlet.name}:row));options.sound('click');
  };
  const getActiveAttendance=(id:string)=>attendanceLogs.find(row=>row.staffId===id&&row.status==='CLOCKED_IN');
  const saveCommissionRule=(rule:StaffCommissionRule)=>setCommissionRules(previous=>previous.some(row=>row.staffId===rule.staffId)?previous.map(row=>row.staffId===rule.staffId?rule:row):[...previous,rule]);
  const savePayrollSlip=(slip:PayrollSlip)=>setPayrollSlips(previous=>previous.some(row=>row.id===slip.id)?previous.map(row=>row.id===slip.id?slip:row):[slip,...previous]);
  const deletePayrollSlip=(id:string)=>setPayrollSlips(previous=>previous.filter(row=>row.id!==id));
  return {staffMembers,setStaffMembers,sectorStaffMembers,addStaffMember,updateStaffMember,deleteStaffMember,toggleStaffAvailability,
    attendanceLogs,setAttendanceLogs,clockInStaff,clockOutStaff,getActiveAttendance,commissionRules,setCommissionRules,
    payrollSlips,setPayrollSlips,saveCommissionRule,savePayrollSlip,deletePayrollSlip};
}
