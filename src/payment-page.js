const { test, expect } = require("@playwright/test");
const { delay, randomize, doWithRetry } = require("./utils");
const {
  goThroughPaymentPageViaApi,
  resolvePaymentPageMode,
  PAYMENT_SANDBOX,
} = require("./payment-api");

async function goThroughPaymentPage({
  page,
  paymentType,
  express = false,
  switchPaymentType = false,
  viaApi,
  preparePage,
  returnUrlPattern,
  fallbackReturnUrl,
}) {
  const mode = resolvePaymentPageMode(viaApi);

  if (mode === "api") {
    return test.step(`easyCredit Payment via API (${paymentType})`, async () => {
      await goThroughPaymentPageViaApi({
        page,
        paymentType,
        express,
        preparePage,
        returnUrlPattern,
        fallbackReturnUrl,
      });
    });
  }

  return test.step(`easyCredit Payment (${paymentType})`, async () => {
    await page.waitForURL(/ratenkauf\.easycredit\.de/i, { timeout: 90000 });
    await page
      .locator("#usercentrics-root")
      .waitFor({ state: "attached", timeout: 15000 })
      .catch(() => {});
    await page
      .evaluate(() => {
        document.getElementById("usercentrics-root")?.remove();
      })
      .catch(() => {});

    if (switchPaymentType) {
      const switchButton = page
        .locator(".paymentoptions")
        .getByText(paymentType === "INSTALLMENT" ? "Rechnung" : "Ratenkauf");
      await expect(switchButton).toBeVisible();
      await switchButton.click({ force: true });
    }

    await page.locator("#next-btn").waitFor({ timeout: 20000 });
    await delay(500);
    await page.locator("#next-btn").click({ force: true });
    await page.waitForFunction(
      () => /mobileident|smstan/.test(window.location.href),
      { timeout: 30000 }
    );

    await page.locator("#mobilfunknummer").getByRole("textbox").fill(PAYMENT_SANDBOX.phone);

    await delay(500);

    await doWithRetry(async () => {
      await page.getByRole("button", { name: /SMS-TAN senden/ }).click({ force: true });
    });

    await page.locator("#mTAN").getByRole("textbox").fill(PAYMENT_SANDBOX.tan);

    await doWithRetry(async () => {
      await page.getByRole("button", { name: "Zur Dateneingabe" }).click();
    });

    if (express) {
      await page.locator("#firstName").fill(randomize("Ralf"));
      await page.locator("#lastName").fill("Ratenkauf");
    }

    await page.locator("input#dateOfBirth").fill("05.04.1972");

    if (express) {
      await page
        .locator("#email")
        .getByRole("textbox")
        .fill(PAYMENT_SANDBOX.expressEmail);
    }

    await page
      .locator("app-ratenkauf-iban-input-dumb")
      .getByRole("textbox")
      .fill(PAYMENT_SANDBOX.iban);

    if (express) {
      await page.locator("#streetAndNumber").fill(PAYMENT_SANDBOX.street);
      await page.locator("#postalCode").fill("90402");
      await page.locator("#city").fill(PAYMENT_SANDBOX.city);
    }

    const sepa = page
      .locator("#agreeSepa")
      .or(page.locator("[data-bb='agreeSepa']"))
      .or(page.getByRole("checkbox", { name: /SEPA|Lastschrift|Mandat/i }))
      .or(page.locator("[formcontrolname='sepamandat']"));
    await sepa.first().click({ force: true });

    await delay(1000);

    await page
      .locator("tbk-button")
      .filter({ hasText: "Zahlungswunsch prüfen" })
      .click({ force: true });

    await delay(500);
    await doWithRetry(async () => {
      await page
        .locator("tbk-button")
        .filter({ hasText: "Zahlung übernehmen" })
        .click({ force: true });
    });
  });
}

module.exports = {
  goThroughPaymentPage,
};
