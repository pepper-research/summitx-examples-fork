import { SwapRouter } from "@summitx/smart-router/evm";
import { Percent, TradeType } from "@summitx/swap-sdk-core";
import { formatUnits, parseUnits } from "viem";
import { baseCampTestnetTokens } from "./config/base-testnet";
import { TokenQuoter } from "./quoter/token-quoter";
import { logger } from "./utils/logger";

async function testNativeSwap() {
  logger.header("🧪 Testing Native CAMP Swap");

  const quoter = new TokenQuoter({
    rpcUrl: "https://rpc-campnetwork.xyz",
    slippageTolerance: 1.0,
    maxHops: 2,
    maxSplits: 2,
    enableV2: false,
    enableV3: true,
  });

  // Test CAMP → USDC (native to ERC20)
  const nativeAmount = "0.01";
  logger.info(`Getting quote for ${nativeAmount} CAMP → USDC`);

  const quote = await quoter.getQuote(
    baseCampTestnetTokens.wcamp, // Use WCAMP token for native
    baseCampTestnetTokens.usdc,
    nativeAmount,
    TradeType.EXACT_INPUT,
    false
  );

  if (!quote || !quote.rawTrade) {
    logger.error("No quote available");
    return;
  }

  logger.success("Quote received:", {
    input: `${nativeAmount} CAMP`,
    output: `${quote.outputAmount} USDC`,
    priceImpact: quote.priceImpact,
  });

  const trade = quote.rawTrade;
  
  // Generate swap parameters
  const methodParameters = SwapRouter.swapCallParameters(trade, {
    slippageTolerance: new Percent(100, 10000), // 1%
    deadline: Math.floor(Date.now() / 1000) + 60 * 20,
    recipient: "0x0000000000000000000000000000000000000001", // dummy address
  });

  logger.divider();
  logger.info("Method Parameters Analysis:");
  
  // Check if value is set by SwapRouter
  logger.info("Original value from SwapRouter:", methodParameters.value || "NOT SET");
  
  // For native swaps, we need to manually set the value
  const nativeValue = parseUnits(nativeAmount, 18);
  logger.info("Native value to send:", formatUnits(nativeValue, 18) + " CAMP");
  
  // Check the calldata
  const functionSelector = methodParameters.calldata.slice(0, 10);
  logger.info("Function selector:", functionSelector);
  
  // Common function selectors for native swaps
  const nativeSwapSelectors = {
    "0x04e45aaf": "exactInputSingle (might need native value)",
    "0xb858183f": "exactInput (might need native value)",
    "0x24856bc3": "execute (multicall with native)",
    "0xac9650d8": "multicall"
  };
  
  const functionName = nativeSwapSelectors[functionSelector as keyof typeof nativeSwapSelectors];
  if (functionName) {
    logger.info("Function:", functionName);
  }

  // Check if input token is native
  const isNativeInput = !trade.inputAmount.currency.isToken;
  logger.info("Is native input?", isNativeInput ? "YES (but using WCAMP)" : "NO");
  
  // Check token addresses
  logger.info("Input token:", trade.inputAmount.currency.symbol, trade.inputAmount.currency.isToken ? `(${trade.inputAmount.currency.address})` : "(native)");
  logger.info("Output token:", trade.outputAmount.currency.symbol, trade.outputAmount.currency.isToken ? `(${trade.outputAmount.currency.address})` : "(native)");

  logger.divider();
  logger.success("Summary:");
  logger.info("1. SwapRouter doesn't set value for native swaps");
  logger.info("2. We must manually set value = parseUnits(amount, 18) for CAMP swaps");
  logger.info("3. The router will wrap CAMP to WCAMP internally");
  logger.info("4. For ERC20 → CAMP, the router should unwrap WCAMP automatically");
}

testNativeSwap().catch((error) => {
  logger.error("Test failed:", error?.message || error);
  process.exit(1);
});