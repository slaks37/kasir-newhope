import React from 'react';
import {useIntelligenceSnapshot} from './useIntelligenceSnapshot';
import {IntelligencePanel} from './IntelligencePanel';
import {usePOS} from '../../context/POSContext';
export function BusinessBrief(){
  const snapshot=useIntelligenceSnapshot();const {setActiveTab}=usePOS();
  return <IntelligencePanel key={snapshot.businessId} snapshot={snapshot} compact onOpen={()=>setActiveTab('ai')}/>;
}
