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

export const ChainAuthorizationAbi = {
    type: "tuple",
    components: [
        { name: "hash", type: "bytes32" },
        ...ChainAuthorizationSignatureComponentsAbi,
    ],
} as const;



export const AuthorizationAbi: AbiParameter = {
    type: "tuple",
    components: [
        { name: "signature", type: "bytes" },
        { name: "chainAuthorizations", ...ChainAuthorizationAbi, type: "tuple[]" },
    ],
};

export interface DelegateSigningMessage {
    address: Address;
    chainId: number;
    nonce: number;
    [key: string]: unknown;
}

export interface CallObject {
    address?: Address;
    abi?: Abi;
    functionName?: string;
    args?: unknown[];
    value?: number;
    authorizationList?: Authorization[];
    error?: string;
}

export interface IntentObject {
    destinationCall: CallObject;
    sourceCall: CallObject;
    destinationChainId: number;
    destinationTokenAddress: Address;
    destinationTokenAmount: number;
    sourceChainId: number;
    sourceTokenAddress: Address;
    sourceTokenAmount: number;
}

export interface DelegationState {
    isDelegated: boolean;
    isLoading: boolean;
    error?: string;
}

export interface DelegationConfig {
    delegateContractAddress: Address;
    sourceChainId: number;
    destinationChainId: number;
    universalAuth?: {
        chainId: number;
        nonce: number;
    };
}

export interface TxSubmitRequest {
    address: Address;
    authorization: Authorization[];
    intentAuthorization: {
        signature: string;
        chainBatches: Array<{
            hash: string;
            chainId: bigint;
            calls: Call[];
            recentBlock: bigint;
        }>;
    };
    tokenAddress?: Address;
    tokenAmount?: bigint;
}

export interface TxSubmitResponse {
    hash: string;
    intentId: string;
}

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
