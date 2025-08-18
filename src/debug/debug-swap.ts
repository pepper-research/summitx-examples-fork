import { SwapRouter } from "@summitx/smart-router/evm";
import { Percent, TradeType } from "@summitx/swap-sdk-core";
import { config } from "dotenv";
import { baseCampTestnetTokens, SMART_ROUTER_ADDRESS } from "./config/base-testnet";
import { TokenQuoter } from "./quoter/token-quoter";
import { logger } from "./utils/logger";

config();

async function debugSwap() {
  logger.header("🔍 Debug Swap Parameters");

  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz",
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 2,
    enableV2: false,
    enableV3: true,
  });

  // Get a quote
  const quote = await quoter.getQuote(
    baseCampTestnetTokens.usdc,
    baseCampTestnetTokens.usdt,
    "0.1",
    TradeType.EXACT_INPUT,
    false
  );

  if (!quote || !quote.rawTrade) {
    logger.error("No quote available");
    return;
  }

  const trade = quote.rawTrade;
  
  // Generate swap parameters
  const methodParameters = SwapRouter.swapCallParameters(trade, {
    slippageTolerance: new Percent(100, 10000), // 1%
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    recipient: "0x0000000000000000000000000000000000000001", // dummy address
  });

  logger.info("Method Parameters:", {
    to: methodParameters.to || "NOT SET",
    value: methodParameters.value,
    calldataLength: methodParameters.calldata?.length,
    calldata: methodParameters.calldata?.slice(0, 10), // First 10 chars (function selector)
  });

  logger.info("Expected Router Address:", SMART_ROUTER_ADDRESS);
  
  if (!methodParameters.to) {
    logger.error("❌ WARNING: 'to' address is not set in methodParameters!");
    logger.info("This will cause a contract creation instead of a swap!");
  } else if (methodParameters.to !== SMART_ROUTER_ADDRESS) {
    logger.error(`❌ WARNING: 'to' address (${methodParameters.to}) doesn't match router (${SMART_ROUTER_ADDRESS})!`);
  } else {
    logger.success("✅ 'to' address correctly set to router");
  }

  // Check the trade object
  logger.info("Trade details:", {
    tradeType: trade.tradeType === TradeType.EXACT_INPUT ? "EXACT_INPUT" : "EXACT_OUTPUT",
    inputAmount: `${trade.inputAmount.toExact()} ${trade.inputAmount.currency.symbol}`,
    outputAmount: `${trade.outputAmount.toExact()} ${trade.outputAmount.currency.symbol}`,
    routes: trade.routes.length,
  });
}

debugSwap().catch((error) => {
  logger.error("Debug failed:", error?.message || error);
  process.exit(1);
});