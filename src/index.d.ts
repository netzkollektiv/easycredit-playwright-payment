import type { Page } from "@playwright/test";

export const PAYMENT_API_HOST: string;

export const PAYMENT_SANDBOX: {
  readonly phone: string;
  readonly phoneE164: string;
  readonly country: string;
  readonly tan: string;
  readonly birthDate: string;
  readonly iban: string;
  readonly email: string;
  readonly expressEmail: string;
  readonly street: string;
  readonly postalCode: string;
  readonly city: string;
  readonly employment: string;
  readonly netIncome: string;
};

export type PaymentPageMode = "api" | "ui";

export interface PaymentPageOptions {
  page: Page;
  /** "INSTALLMENT" or "BILL". Plugin enums with those values are accepted. */
  paymentType: string;
  express?: boolean;
  /** Magento switches the hosted widget between installment and bill. */
  switchPaymentType?: boolean;
  /** Use the payment API instead of the hosted UI. Defaults to EASYCREDIT_PAYMENT_API. */
  viaApi?: boolean;
  /**
   * Runs before the API flow waits for the hosted page.
   * WooCommerce uses this to fail fast when checkout never redirects.
   */
  preparePage?: (page: Page) => Promise<void>;
  /** URL matched after the shop return. Default covers Magento review, Shopware confirm, and WooCommerce order-received. */
  returnUrlPattern?: RegExp | string;
  fallbackReturnUrl?: string;
}

export function shouldUsePaymentApi(explicit?: boolean): boolean;
export function resolvePaymentPageMode(viaApi?: boolean): PaymentPageMode;
export function extractTechnicalTransactionId(url: string): string | null;
export function goThroughPaymentPageViaApi(options: PaymentPageOptions): Promise<void>;
export function goThroughPaymentPage(options: PaymentPageOptions): Promise<void>;
