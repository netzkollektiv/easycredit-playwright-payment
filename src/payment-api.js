const { randomUUID } = require("node:crypto");
const { expect } = require("@playwright/test");
const { delay, randomize } = require("./utils");

const PAYMENT_API_HOST = "https://ratenkauf.easycredit.de";

const PAYMENT_SANDBOX = {
  phone: "1712345678",
  phoneE164: "+491712345678",
  country: "DE",
  tan: "000000",
  birthDate: "1972-04-05",
  iban: "DE12500105170648489890",
  email: "test@email.com",
  expressEmail: "ralf.ratenkauf@teambank.de",
  street: "Beuthener Str. 25",
  postalCode: "90471",
  city: "Nürnberg",
  employment: "ANGESTELLTER",
  netIncome: "1750",
};

function shouldUsePaymentApi(explicit) {
  if (explicit !== undefined) {
    return explicit;
  }
  const env = process.env.EASYCREDIT_PAYMENT_API?.toLowerCase();
  return env === "1" || env === "true" || env === "yes";
}

function resolvePaymentPageMode(viaApi) {
  return shouldUsePaymentApi(viaApi) ? "api" : "ui";
}

function extractTechnicalTransactionId(url) {
  const match = url.match(/\/app\/payment\/([^/]+)/);
  return match ? match[1] : null;
}

function isMtanReady(vorgang) {
  return (
    vorgang.mtanPruefungPositiv === "true" ||
    vorgang.mtanPruefungPositiv === "GATEWAY_DOWN"
  );
}

function logVorgang(label, vorgang, extra = "") {
  console.log(
    `[payment-api] ${label} status=${vorgang.status ?? "n/a"} mtan=${vorgang.mtanPruefungPositiv ?? "n/a"} device=${vorgang.deviceIdentToken ? "yes" : "no"}${extra}`
  );
}

function parseBody(text) {
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

const TRACE_HEADER_NAMES = [
  "x-request-id",
  "x-correlation-id",
  "correlation-id",
  "request-id",
  "x-trace-id",
  "traceparent",
  "tracestate",
  "x-b3-traceid",
  "x-b3-spanid",
  "x-amzn-trace-id",
  "cf-ray",
  "x-served-by",
  "x-tb-request-id",
  "x-transaction-id",
  "x-vcap-request-id",
];

function pickTraceHeaders(headers) {
  const picked = {};
  for (const [name, value] of Object.entries(headers)) {
    if (TRACE_HEADER_NAMES.includes(name.toLowerCase())) {
      picked[name] = value;
    }
  }
  return picked;
}

function logPaymentHttp(method, url, status, headers) {
  const trace = pickTraceHeaders(headers);
  console.log(
    `[payment-api] ${method} ${url} => ${status} trace=${JSON.stringify(trace)} headers=${JSON.stringify(headers)}`
  );
}

function attachPaymentApiLogger(page) {
  page.on("response", (response) => {
    const url = response.url();
    if (!url.includes("ratenkauf.easycredit.de/api/")) {
      return;
    }
    logPaymentHttp(
      response.request().method(),
      url,
      response.status(),
      response.headers()
    );
  });
}

async function logCookieNames(page, label) {
  const cookies = await page.context().cookies("https://ratenkauf.easycredit.de");
  const names = cookies.map((cookie) => cookie.name).join(",");
  console.log(`[payment-api] ${label} cookies=${names || "(none)"}`);
}

async function pageApiPost(page, path, data, method = "POST") {
  const response = await page.evaluate(
    async ({ path, data, method }) => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(method, path, true);
        xhr.withCredentials = true;
        xhr.setRequestHeader("Accept", "application/hal+json");
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = () => {
          const headers = {};
          for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
            const idx = line.indexOf(":");
            if (idx > 0) {
              headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
            }
          }
          resolve({
            status: xhr.status,
            ok: xhr.status >= 200 && xhr.status < 300,
            text: xhr.responseText,
            href: window.location.href,
            headers,
          });
        };
        xhr.onerror = () => reject(new Error(`XHR failed for ${path}`));
        xhr.send(JSON.stringify(data));
      });
    },
    { path, data, method }
  );
  return { ...response, json: parseBody(response.text) };
}

async function pageApiGet(page, path) {
  const response = await page.evaluate(async (path) => {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", path, true);
      xhr.withCredentials = true;
      xhr.setRequestHeader("Accept", "application/hal+json");
      xhr.onload = () => {
        const headers = {};
        for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
          const idx = line.indexOf(":");
          if (idx > 0) {
            headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
          }
        }
        resolve({
          status: xhr.status,
          ok: xhr.status >= 200 && xhr.status < 300,
          text: xhr.responseText,
          href: window.location.href,
          headers,
        });
      };
      xhr.onerror = () => reject(new Error(`XHR GET failed for ${path}`));
      xhr.send();
    });
  }, path);
  return { ...response, json: parseBody(response.text) };
}

async function assertPageApiOk(response, label) {
  if (!response.ok) {
    throw new Error(`${label} failed (${response.status}): ${response.text}`);
  }
}

async function getVorgangFromPage(page, vorgangId) {
  const response = await pageApiGet(page, `/api/payment/vorgang/${vorgangId}`);
  await assertPageApiOk(response, `GET vorgang ${vorgangId}`);
  return response.json;
}

async function waitUntilMtanReady(page, vorgangId) {
  let latest = await getVorgangFromPage(page, vorgangId);
  for (let attempt = 1; attempt <= 8; attempt++) {
    logVorgang(`mtan-poll#${attempt}`, latest);
    if (isMtanReady(latest)) {
      return latest;
    }
    await delay(750);
    latest = await getVorgangFromPage(page, vorgangId);
  }
  return latest;
}

async function setPaymentPath(page, technicalTransactionId, step) {
  await page.evaluate(
    ({ technicalTransactionId, step }) => {
      window.history.replaceState(
        window.history.state,
        "",
        `/app/payment/${technicalTransactionId}/${step}`
      );
    },
    { technicalTransactionId, step }
  );
}

function buildEntscheidungBody({ vorgang, express }) {
  const person = vorgang.person ?? {};
  const adresse = vorgang.adresse ?? {};
  const kontakt = vorgang.kontakt ?? {};

  return {
    person: {
      anrede: person.anrede ?? "FRAU",
      vorname: express ? randomize("Ralf") : person.vorname ?? "Ralf",
      nachname: person.nachname ?? "Ratenkauf",
      geburtsdatum: PAYMENT_SANDBOX.birthDate,
      beschaeftigung: PAYMENT_SANDBOX.employment,
      nettoeinkommen: PAYMENT_SANDBOX.netIncome,
    },
    adresse: {
      strasseHausNr: adresse.strasseHausNr ?? PAYMENT_SANDBOX.street,
      plz: adresse.plz ?? PAYMENT_SANDBOX.postalCode,
      ort: adresse.ort ?? PAYMENT_SANDBOX.city,
    },
    kontakt: {
      email: express ? PAYMENT_SANDBOX.expressEmail : kontakt.email ?? PAYMENT_SANDBOX.email,
      mobilfunknummer: PAYMENT_SANDBOX.phoneE164,
      pruefungMobilfunknummerUebergehen: true,
    },
    bank: {
      iban: PAYMENT_SANDBOX.iban,
    },
    zustimmung: {
      sepamandat: true,
      angebotsbestaetigung: true,
      angebote: false,
    },
  };
}

async function dismissConsent(page) {
  await page
    .locator("#usercentrics-root")
    .waitFor({ state: "attached", timeout: 15000 })
    .catch(() => {});
  await page
    .evaluate(() => {
      document.getElementById("usercentrics-root")?.remove();
    })
    .catch(() => {});
}

async function goThroughPaymentPageViaApi({
  page,
  paymentType,
  express = false,
  preparePage,
  returnUrlPattern,
  fallbackReturnUrl,
}) {
  if (typeof preparePage === "function") {
    await preparePage(page);
  }

  attachPaymentApiLogger(page);

  const angularVorgangResponse = page.waitForResponse(
    (response) =>
      /\/api\/payment\/vorgang\/[^/?]+$/.test(response.url()) &&
      response.request().method() === "GET" &&
      response.ok(),
    { timeout: 30000 }
  );
  const angularBetrugResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/betrugserkennung") &&
      response.request().method() === "POST",
    { timeout: 30000 }
  );
  const angularWebshopResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/payment/webshop/") &&
      response.request().method() === "GET",
    { timeout: 30000 }
  );

  await page.waitForURL(/ratenkauf\.easycredit\.de\/app\/payment\//i, {
    timeout: 90000,
  });
  await dismissConsent(page);

  if (
    !/\/(mobileident|smstan|datenerfassen)/i.test(page.url()) &&
    !/finanzierungsvorgaben/i.test(page.url())
  ) {
    await page.waitForURL(/finanzierungsvorgaben/i, { timeout: 10000 }).catch(() => {});
  }

  const technicalTransactionId = extractTechnicalTransactionId(page.url());
  if (!technicalTransactionId) {
    throw new Error(`Could not extract technicalTransactionId from ${page.url()}`);
  }

  const phonePayload = {
    telefonnummer: PAYMENT_SANDBOX.phoneE164,
    land: PAYMENT_SANDBOX.country,
  };

  const landingVorgangResponse = await angularVorgangResponse.catch(() => null);
  const vorgang = landingVorgangResponse
    ? await landingVorgangResponse.json()
    : await getVorgangFromPage(page, technicalTransactionId);
  const fachlicheVorgangskennung = vorgang.fachlicheVorgangskennung;
  logVorgang(
    "landing",
    vorgang,
    ` url=${page.url()} technical=${technicalTransactionId} fachlich=${fachlicheVorgangskennung}`
  );
  await logCookieNames(page, "landing");

  const webshop = await angularWebshopResponse.catch(() => null);
  if (!webshop && vorgang.shopKennung) {
    await assertPageApiOk(
      await pageApiGet(page, `/api/payment/webshop/${vorgang.shopKennung}`),
      "GET webshop"
    );
  }

  const betrug = await angularBetrugResponse.catch(() => null);
  if (!betrug) {
    await assertPageApiOk(
      await pageApiPost(
        page,
        `/api/payment/vorgang/${technicalTransactionId}/betrugserkennung`,
        { bioCatchSessionId: randomUUID() }
      ),
      "POST betrugserkennung"
    );
  }

  if (paymentType === "INSTALLMENT") {
    await assertPageApiOk(
      await pageApiPost(page, `/api/payment/vorgang/${technicalTransactionId}/laufzeit`, {
        laufzeit: 10,
      }),
      "POST laufzeit"
    );
  }

  await setPaymentPath(page, technicalTransactionId, "mobileident");

  await assertPageApiOk(
    await pageApiPost(page, "/api/payment/telefonnummer", phonePayload),
    "POST telefonnummer"
  );

  await assertPageApiOk(
    await pageApiPost(
      page,
      `/api/payment/vorgang/${technicalTransactionId}/mtan`,
      phonePayload
    ),
    "POST mtan"
  );

  await setPaymentPath(page, technicalTransactionId, "smstan");

  const mtanConfirmation = await pageApiPost(
    page,
    `/api/payment/vorgang/${technicalTransactionId}/mtan/confirmation`,
    { mtan: PAYMENT_SANDBOX.tan }
  );
  await assertPageApiOk(mtanConfirmation, "POST mtan/confirmation");

  const vorgangAfterMtan = isMtanReady(mtanConfirmation.json)
    ? mtanConfirmation.json
    : await waitUntilMtanReady(page, technicalTransactionId);
  if (!isMtanReady(vorgangAfterMtan)) {
    throw new Error(
      `mTAN was not confirmed (mtanPruefungPositiv=${vorgangAfterMtan.mtanPruefungPositiv})`
    );
  }

  const abtestResponse = await pageApiPost(
    page,
    "/api/payment/abtest",
    {
      type: "TEST_CONFIRMATION_PAGE",
      term: "D",
      vorgangskennung: technicalTransactionId,
    },
    "PUT"
  );
  if (!abtestResponse.ok) {
    console.log(`[payment-api] PUT abtest ignored (${abtestResponse.status})`);
  }

  await setPaymentPath(page, technicalTransactionId, "datenerfassen");

  const vorname =
    (express ? randomize("Ralf") : vorgangAfterMtan.person?.vorname) ?? "Ralf";
  const nachname = vorgangAfterMtan.person?.nachname ?? "Ratenkauf";
  const anrede = vorgangAfterMtan.person?.anrede ?? "FRAU";

  await pageApiPost(page, `/api/payment/name?vorgangskennung=${fachlicheVorgangskennung}`, {
    vorname,
    nachname,
    anrede,
  }).catch(() => {});

  await assertPageApiOk(
    await pageApiPost(
      page,
      `/api/payment/adresse?vorgangskennung=${fachlicheVorgangskennung}`,
      {
        strasseHausNr: vorgangAfterMtan.adresse?.strasseHausNr ?? PAYMENT_SANDBOX.street,
        plz: vorgangAfterMtan.adresse?.plz ?? PAYMENT_SANDBOX.postalCode,
        ort: vorgangAfterMtan.adresse?.ort ?? PAYMENT_SANDBOX.city,
        land: PAYMENT_SANDBOX.country,
      }
    ),
    "POST adresse"
  );

  await assertPageApiOk(
    await pageApiPost(
      page,
      `/api/payment/bankdaten?vorgangskennung=${fachlicheVorgangskennung}`,
      {
        iban: PAYMENT_SANDBOX.iban,
        land: PAYMENT_SANDBOX.country,
        kontoinhaber: {
          vorname,
          nachname,
        },
      }
    ),
    "POST bankdaten"
  );

  const vorgangAfter = await getVorgangFromPage(page, technicalTransactionId);
  logVorgang("after-bankdaten", vorgangAfter, ` url=${page.url()}`);
  await logCookieNames(page, "before-entscheidung");

  const vorgangIdForEntscheidung = vorgangAfter.tbVorgangskennung ?? technicalTransactionId;
  const entscheidungBody = buildEntscheidungBody({
    vorgang: {
      ...vorgangAfter,
      person: { ...vorgangAfter.person, vorname, nachname, anrede },
    },
    express,
  });
  const entscheidungErrors = [];
  let entscheidungOk = false;

  for (let attempt = 1; attempt <= 3; attempt++) {
    await delay(attempt === 1 ? 500 : 1500);
    const entscheidungResponse = await pageApiPost(
      page,
      `/api/payment/vorgang/${vorgangIdForEntscheidung}/entscheidung`,
      entscheidungBody
    );
    console.log(
      `[payment-api] POST entscheidung attempt=${attempt} status=${entscheidungResponse.status} href=${entscheidungResponse.href}${entscheidungResponse.ok ? "" : ` body=${entscheidungResponse.text}`}`
    );

    if (entscheidungResponse.ok) {
      entscheidungOk = true;
      break;
    }

    entscheidungErrors.push(
      `#${attempt} => ${entscheidungResponse.status} ${entscheidungResponse.text}`
    );

    if (entscheidungResponse.status !== 404) {
      break;
    }
  }

  if (!entscheidungOk) {
    throw new Error(`POST entscheidung failed: ${entscheidungErrors.join(" | ")}`);
  }

  await assertPageApiOk(
    await pageApiPost(page, `/api/payment/vorgang/${vorgangIdForEntscheidung}/annahme`, {}),
    "POST annahme"
  );

  const returnUrl = vorgang.ruecksprungAdressen?.erfolgUrl ?? fallbackReturnUrl;
  if (!returnUrl) {
    throw new Error(
      "Payment response has no success URL. Pass fallbackReturnUrl when creating the payment helper."
    );
  }
  await page.goto(returnUrl);
  if (returnUrlPattern) {
    await page.waitForURL(returnUrlPattern, { timeout: 90000 });
  }

  await expect(page).not.toHaveURL(/ratenkauf\.easycredit\.de/i);
}

module.exports = {
  PAYMENT_API_HOST,
  PAYMENT_SANDBOX,
  shouldUsePaymentApi,
  resolvePaymentPageMode,
  extractTechnicalTransactionId,
  goThroughPaymentPageViaApi,
};
