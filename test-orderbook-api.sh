#!/bin/bash

# Test the /public/orderbook-ws endpoint with demo pairs

echo "🔧 Testing /public/orderbook-ws endpoint..."
echo ""

# Colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

API="http://127.0.0.1:8000"

test_endpoint() {
    local exchange=$1
    local symbol=$2

    echo -e "${BLUE}Testing: ${exchange} / ${symbol}${NC}"

    response=$(curl -s "${API}/public/orderbook-ws?exchange=${exchange}&symbol=$(echo -n "${symbol}" | jq -sRr @uri)")

    if [[ $response == *"bestBid"* ]]; then
        best_bid=$(echo "$response" | jq '.bestBid // 0')
        best_ask=$(echo "$response" | jq '.bestAsk // 0')
        spread=$(echo "$response" | jq '.spread // 0')
        bid_count=$(echo "$response" | jq '.bids | length')
        ask_count=$(echo "$response" | jq '.asks | length')

        echo -e "${GREEN}✓ Success${NC}"
        echo "  Best Bid: $best_bid"
        echo "  Best Ask: $best_ask"
        echo "  Spread: $spread"
        echo "  Bid levels: $bid_count"
        echo "  Ask levels: $ask_count"
    else
        echo -e "${RED}✗ Failed${NC}"
        echo "  Response: ${response:0:100}..."
    fi
    echo ""
}

# Test ETH/USD and LCX/USDC demo pairs
test_endpoint "lcx" "LCX/USDC"
test_endpoint "lcx" "ETH/EUR"
test_endpoint "kraken" "ETH/USD"
test_endpoint "coinbase" "ETH/USD"

echo -e "${BLUE}Test complete!${NC}"
