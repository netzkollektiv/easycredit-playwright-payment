const paymentApi = require("./payment-api");
const { goThroughPaymentPage } = require("./payment-page");

function createEasyCreditPayment(defaults = {}) {
  return {
    goThroughPaymentPage(options) {
      return goThroughPaymentPage({ ...defaults, ...options });
    },
    goThroughPaymentPageViaApi(options) {
      return paymentApi.goThroughPaymentPageViaApi({ ...defaults, ...options });
    },
  };
}

module.exports = {
  ...paymentApi,
  goThroughPaymentPage,
  createEasyCreditPayment,
};
