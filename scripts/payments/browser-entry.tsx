// Loopback-only fixture entry; no application import or hosted fixture endpoint.
import React from 'react';import {createRoot} from 'react-dom/client';
import {SubscriptionBillingTab} from '../../src/components/settings/SubscriptionBillingTab';
import {SubscriptionPaymentPage} from '../../src/components/payment/SubscriptionPaymentPage';
import '../../src/index.css';
createRoot(document.getElementById('root')!).render(<><p role="status">DATA SINTETIS · PROVIDER MOCK · TANPA UANG NYATA</p>{location.pathname==='/subscription'?<SubscriptionPaymentPage/>:<SubscriptionBillingTab/>}</>);
