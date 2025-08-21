import { type PublicClient, type Hash } from "viem";
import { logger } from "./logger";

export async function waitForTransaction(
  publicClient: PublicClient,
  hash: Hash,
  description?: string
): Promise<void> {
  logger.info(`⏳ Waiting for transaction confirmation${description ? `: ${description}` : ""}...`);
  logger.info(`Transaction hash: ${hash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  if (receipt.status === "success") {
    logger.success(`✅ Transaction confirmed! Gas used: ${receipt.gasUsed}`);
  } else {
    throw new Error(`Transaction failed: ${hash}`);
  }
}

export async function delay(ms: number, message?: string): Promise<void> {
  const defaultMessage = `⏳ Waiting ${ms / 1000} seconds before next transaction...`;
  logger.info(message || defaultMessage);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function approveTokenWithWait(
  walletClient: any,
  publicClient: PublicClient,
  tokenAddress: any,
  spender: any,
  amount: bigint,
  tokenSymbol?: string,
  waitTime: number = 3000
): Promise<void> {
  const ERC20_ABI = [
    {
      name: "approve",
      type: "function",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
      stateMutability: "nonpayable",
    },
    {
      name: "allowance",
      type: "function",
      inputs: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
      ],
      outputs: [{ name: "", type: "uint256" }],
      stateMutability: "view",
    },
  ] as const;

  const account = walletClient.account.address;
  
  const allowance = await publicClient.readContract({
    address: tokenAddress,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account, spender],
  });

  if (allowance < amount) {
    logger.info(`📝 Approving ${tokenSymbol || tokenAddress} for spending...`);
    
    const hash = await walletClient.writeContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [spender, amount],
    });
    
    await waitForTransaction(publicClient, hash, `${tokenSymbol || "token"} approval`);
    
    // Add a delay after approval to ensure the transaction is fully processed
    await delay(waitTime, `⏳ Waiting ${waitTime / 1000} seconds after approval before proceeding...`);
  } else {
    logger.info(`✅ ${tokenSymbol || "Token"} already approved`);
  }
}