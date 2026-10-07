# easycredit-playwright-payment

Playwright helpers for the easyCredit hosted payment page (`ratenkauf.easycredit.de`). Shop plugins share one implementation of the sandbox flow.

`goThroughPaymentPage` drives the hosted UI. Set `EASYCREDIT_PAYMENT_API=true` (or pass `viaApi: true`) to complete the same page through the payment API with in-page requests, so the shop session cookies stay attached.

```js
const { createEasyCreditPayment } = require("easycredit-playwright-payment");

const { goThroughPaymentPage } = createEasyCreditPayment({
  // Where this shop lands after the hosted payment page.
  returnUrlPattern: /easycredit\/checkout\/review/i,
});

await goThroughPaymentPage({
  page,
  paymentType: "INSTALLMENT", // or "BILL"
  express: false,
});
```

Sandbox phone, TAN, and customer data live in `PAYMENT_SANDBOX`.

Install it from GitHub:

```json
"easycredit-playwright-payment": "github:netzkollektiv/easycredit-playwright-payment"
```
