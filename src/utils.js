function delay(time) {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

function randomize(name, num = 3) {
  let result = name;
  for (let i = 0; i < num; i++) {
    result += String.fromCharCode(97 + Math.floor(Math.random() * 26));
  }
  return result;
}

async function doWithRetry(fn, maxRetries = 3, retryDelayMs = 500) {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      await fn();
      return;
    } catch (error) {
      attempt += 1;
      if (attempt === maxRetries) {
        throw error;
      }
      await delay(retryDelayMs);
    }
  }
}

module.exports = {
  delay,
  randomize,
  doWithRetry,
};
