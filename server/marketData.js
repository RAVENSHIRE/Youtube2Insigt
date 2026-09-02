const { TwelveDataProvider } = require("./providers/twelveDataProvider");

const provider = new TwelveDataProvider();

async function getQuote(symbol) {
  return provider.getQuote(symbol);
}

module.exports = {
  getQuote
};
