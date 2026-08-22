// Client-side PostHog Telemetry Wrapper Utility
// Multi-tenant non-PII product analytics & audit trail

declare global {
  interface Window {
    posthog?: {
      init: (apiKey: string, options?: Record<string, any>) => void;
      identify: (distinctId: string, userProperties?: Record<string, any>) => void;
      capture: (eventName: string, properties?: Record<string, any>) => void;
      reset: () => void;
    };
  }
}

export interface PostHogUserContext {
  userId: string;
  role: string;
  tenantId: string;
  businessSector?: string;
}

class PostHogTelemetryService {
  private isInitialized = false;
  private currentTenantId: string = 'tenant-default';
  private currentUserRole: string = 'CASHIER';

  public init(userCtx?: PostHogUserContext) {
    if (typeof window === 'undefined') return;

    this.isInitialized = true;
    if (userCtx) {
      this.identifyUser(userCtx);
    }
  }

  public identifyUser(userCtx: PostHogUserContext) {
    this.currentTenantId = userCtx.tenantId;
    this.currentUserRole = userCtx.role;

    // Non-PII identification (only tenantId & role, no personal names, emails, or phone numbers)
    if (typeof window !== 'undefined' && window.posthog) {
      window.posthog.identify(userCtx.userId, {
        business_id: userCtx.tenantId,
        user_role: userCtx.role,
        business_sector: userCtx.businessSector || 'FNB',
      });
    }

    this.sendEvent('user_logged_in', {
      user_id: userCtx.userId,
      user_role: userCtx.role,
      business_id: userCtx.tenantId,
    });
  }

  public trackFeatureUsage(featureName: string, metadata: Record<string, any> = {}) {
    this.sendEvent('feature_used', {
      feature_name: featureName,
      business_id: this.currentTenantId,
      user_role: this.currentUserRole,
      ...metadata,
    });
  }

  public trackScreenView(screenName: string) {
    this.sendEvent('screen_viewed', {
      screen_name: screenName,
      business_id: this.currentTenantId,
      user_role: this.currentUserRole,
    });
  }

  public trackTransactionCompleted(transactionData: {
    transactionId: string;
    totalAmount: number;
    itemCount: number;
    paymentMethod: string;
    orderType: string;
    tenantId?: string;
    userRole?: string;
  }) {
    // Dual-Event Pattern: Masking PII (no customer name or credit card numbers)
    this.sendEvent('pos_transaction_completed', {
      transaction_id: transactionData.transactionId,
      total_amount: transactionData.totalAmount,
      item_count: transactionData.itemCount,
      payment_method: transactionData.paymentMethod,
      order_type: transactionData.orderType,
      business_id: transactionData.tenantId || this.currentTenantId,
      user_role: transactionData.userRole || this.currentUserRole,
    });
  }

  public trackError(errorMessage: string, componentStack?: string) {
    this.sendEvent('app_error_triggered', {
      error_message: errorMessage,
      component_stack: componentStack,
      business_id: this.currentTenantId,
      user_role: this.currentUserRole,
    });
  }

  private sendEvent(eventName: string, properties: Record<string, any>) {
    // Asynchronous non-blocking queue execution so UI is never blocked
    setTimeout(() => {
      try {
        if (typeof window !== 'undefined' && window.posthog) {
          window.posthog.capture(eventName, properties);
        } else {
          // Fallback console log for local development/testing without live PostHog API Key
          console.log(`[PostHog Telemetry Track] ${eventName}`, properties);
        }
      } catch (err) {
        console.error('[PostHog Telemetry Error]', err);
      }
    }, 0);
  }
}

export const posthogTelemetry = new PostHogTelemetryService();
