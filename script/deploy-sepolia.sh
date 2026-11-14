#!/usr/bin/env bash
# Deploy TradeJournal to Base Sepolia (TESTNET ONLY).
# Usage:
#   DEPLOYER_KEY=0x... ./script/deploy-sepolia.sh
# The key is passed ONLY via env — never commit it, never print it.
# Writes contracts/deployment-sepolia.json with the address + tx hash.
# Never point this at mainnet.
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.foundry/bin:$PATH"

SEPOLIA_RPC="${SEPOLIA_RPC:-https://sepolia.base.org}" # Base Sepolia, chain 84532
: "${DEPLOYER_KEY:?set DEPLOYER_KEY (Base Sepolia testnet deployer key, 0x...)}"

DEPLOYER="$(cast wallet address --private-key "$DEPLOYER_KEY")"
echo "Deployer: $DEPLOYER"
BAL="$(cast balance "$DEPLOYER" --rpc-url "$SEPOLIA_RPC")"
echo "Sepolia balance: $(cast from-wei "$BAL" ether) ETH"

forge build

OUT="$(forge create contracts/TradeJournal.sol:TradeJournal \
  --rpc-url "$SEPOLIA_RPC" \
  --private-key "$DEPLOYER_KEY" \
  --broadcast \
  --json)"
ADDR="$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployedTo'])")"
TX="$(echo "$OUT" | python3 -c "import sys,json; print(json.load(sys.stdin)['transactionHash'])")"
echo "TradeJournal deployed: $ADDR"
echo "Deploy tx: $TX"

python3 - "$ADDR" "$TX" <<'EOF'
import json, sys
addr, tx = sys.argv[1], sys.argv[2]
with open("contracts/deployment-sepolia.json", "w") as f:
    json.dump(
        {
            "network": "base-sepolia",
            "chainId": 84532,
            "contract": "TradeJournal",
            "address": addr,
            "txHash": tx,
            "explorer": f"https://sepolia.basescan.org/address/{addr}",
        },
        f,
        indent=2,
    )
    f.write("\n")
EOF
echo "Wrote contracts/deployment-sepolia.json"
