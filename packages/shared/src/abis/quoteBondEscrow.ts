/**
 * Minimal viem ABI for QuoteBondEscrow (packages/contracts/src/QuoteBondEscrow.sol) — the functions +
 * events the agent encodes/decodes for the bond flow. Hand-authored (not in the Foundry sync-abis
 * pipeline) since only these fragments are needed off-chain.
 */
export const quoteBondEscrowAbi = [
  {
    type: "function",
    name: "postBond",
    stateMutability: "nonpayable",
    inputs: [
      { name: "quoteId", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "expiresAt", type: "uint64" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "refundBond",
    stateMutability: "nonpayable",
    inputs: [{ name: "quoteId", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "event",
    name: "BondPosted",
    inputs: [
      { name: "quoteId", type: "bytes32", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
      { name: "expiresAt", type: "uint64", indexed: false },
    ],
  },
  {
    type: "event",
    name: "BondRefunded",
    inputs: [
      { name: "quoteId", type: "bytes32", indexed: true },
      { name: "poster", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;
