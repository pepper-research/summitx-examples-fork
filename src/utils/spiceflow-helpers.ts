import {
    Abi,
    AbiParameter,
    Address,
    Authorization,
    encodeAbiParameters,
    Hash,
    Hex,
    keccak256,
    PublicClient,
    WalletClient,
} from "viem";
import "dotenv/config";
import axios from "axios";

export type Call =
    | never
    | {
        to: Address;
        value: bigint;
        data: Hex;
    };

export const CallAbi = {
    type: "tuple",
    components: [
        { name: "to", type: "address" },
        { name: "value", type: "uint" },
        { name: "data", type: "bytes" },
    ],
} as const;

export interface ChainBatchInput {
    chainId: bigint | number;
    calls: Call[];
    recentBlock: bigint | number;
}

export type ChainBatch =
    | never
    | {
        hash: Hash;
        chainId: bigint;
        calls: Call[];
        recentBlock: bigint;
    };

export const ChainAuthorizationSignatureComponentsAbi = [
    { name: "chainId", type: "uint256" },
    { name: "calls", ...CallAbi, type: "tuple[]" },
    { name: "recentBlock", type: "uint256" },
] as const;

export function hashChainBatches(
    chainCalls: ChainBatchInput[],
): ChainBatch[] {
    return chainCalls.map(({ chainId, calls, recentBlock }) => {
        chainId = BigInt(chainId);
        recentBlock = BigInt(recentBlock);

        const hash = keccak256(
            encodeAbiParameters(ChainAuthorizationSignatureComponentsAbi, [
                chainId,
                calls,
                recentBlock,
            ]),
        );

        return {
            hash,
            chainId,
            calls,
            recentBlock,
        };
    });
}

export function getIntentHash(
    chainAuthorizations: ChainBatch[],
): Hash {
    const chainAuthorizationHashes = chainAuthorizations.map(({ hash }) => hash);
    return keccak256(
        encodeAbiParameters([{ type: "bytes32[]" }], [chainAuthorizationHashes]),
    );
}

export function selectChainForChainBatches(
  chainBatches: ChainBatch[],
  { chainId }: { chainId: bigint },
): ChainBatch[] {
  return chainBatches.map((auth) => ({
    ...auth,
    calls: chainId == auth.chainId ? auth.calls : [],
  }));
}
