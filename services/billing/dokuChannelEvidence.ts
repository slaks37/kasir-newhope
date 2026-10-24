/** Exact documented channel mapping, after envelope authentication only.
 * Checkout method QRIS and provider channel QRIS_DOKU are different identifiers.
 * This does not parse/authorize native SNAP or archived WORDS notifications.
 */
export function dokuChannelEvidence(body: any): {channel:string;providerChannel:string;issue?:string} {
  const raw=body?.channel?.id;
  const providerChannel=typeof raw==='string' && /^[A-Z0-9_]{1,100}$/.test(raw)?raw:'';
  if(providerChannel==='QRIS_DOKU') {
    if(body?.service?.id!=='QRIS' || body?.acquirer?.id!=='DOKU')return {channel:'',providerChannel,issue:'QRIS_CHANNEL_IDENTITY_MISMATCH'};
    return {channel:'QRIS',providerChannel};
  }
  if(providerChannel==='QRIS' && (body?.service?.id!==undefined && body.service.id!=='QRIS' || body?.acquirer?.id!==undefined && body.acquirer.id!=='DOKU')) {
    return {channel:'',providerChannel,issue:'QRIS_CHANNEL_IDENTITY_MISMATCH'};
  }
  return {channel:providerChannel,providerChannel};
}

/** Request-Id identifies a delivery, not a QRIS payment. Never use it as proof. */
export function dokuPaymentReference(body: any): string | undefined {
  const evidence=dokuChannelEvidence(body);
  if(evidence.issue)return undefined;
  const approval=evidence.channel==='QRIS'?body?.emoney_payment?.approval_code:undefined;
  const ref=approval ?? body?.transaction?.original_request_id ?? body?.transaction?.reference_id;
  return typeof ref==='string' && /^[A-Za-z0-9._:-]{1,128}$/.test(ref)?ref:undefined;
}
