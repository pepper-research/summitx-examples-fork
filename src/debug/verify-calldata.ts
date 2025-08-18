import { logger } from "../utils/logger";

// Known SwapRouter function selectors
const FUNCTION_SELECTORS: Record<string, string> = {
  "0x04e45aaf": "exactInputSingle",
  "0x5023b4df": "exactOutputSingle", 
  "0xb858183f": "exactInput",
  "0x09b81346": "exactOutput",
  "0x24856bc3": "execute",
  "0xac9650d8": "multicall",
  "0x472b43f3": "swapExactTokensForTokens",
  "0x42712a67": "swapTokensForExactTokens",
};

export function verifyCalldata(calldata: string): void {
  if (!calldata || calldata.length < 10) {
    logger.error("Invalid calldata");
    return;
  }

  const selector = calldata.slice(0, 10);
  const functionName = FUNCTION_SELECTORS[selector];

  if (functionName) {
    logger.success(`✅ Valid SwapRouter function: ${functionName} (${selector})`);
  } else {
    logger.warn(`⚠️ Unknown function selector: ${selector}`);
    logger.info("This might be a multicall or encoded transaction");
  }

  logger.info("Calldata details:", {
    selector,
    length: calldata.length,
    functionName: functionName || "Unknown",
  });
}

// Test with a sample calldata
if (require.main === module) {
  // Sample calldata from our swap
  const sampleCalldata = "0x04e45aaf000000000000000000000000...";
  verifyCalldata(sampleCalldata);
}