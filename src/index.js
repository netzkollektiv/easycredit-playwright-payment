const paymentApi = require("./payment-api");
const { goThroughPaymentPage } = require("./payment-page");

module.exports = {
  ...paymentApi,
  goThroughPaymentPage,
};
