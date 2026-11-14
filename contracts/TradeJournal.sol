// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @title TradeJournal
/// @notice Minimal on-chain audit trail for StockPilot's PAPER trades.
/// @dev Testnet only (Base Sepolia). No real money, no custody, no trading:
/// the contract only records what the off-chain paper-trading agent did,
/// so anyone can verify the agent's history against the chain.
/// Each record stores the symbol, side, token amount (8 decimals, B20
/// style), price in USD with 8 decimals (Chainlink style), and the
/// keccak256 of the human-readable reason string.
contract TradeJournal {
    address public owner;
    uint256 public tradeCount;

    struct Trade {
        string symbol;
        bool isBuy;
        uint256 amount; // token units, 8 decimals
        uint256 price; // USD, 8 decimals
        bytes32 reasonHash;
        uint256 timestamp;
    }

    mapping(uint256 => Trade) public trades;

    event TradeRecorded(
        uint256 indexed id,
        string symbol,
        bool isBuy,
        uint256 amount,
        uint256 price,
        bytes32 reasonHash,
        uint256 timestamp
    );

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "TradeJournal: not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "TradeJournal: zero owner");
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    /// @notice Record one paper trade. Returns the sequential id.
    function recordTrade(
        string calldata symbol,
        bool isBuy,
        uint256 amount,
        uint256 price,
        bytes32 reasonHash
    ) external onlyOwner returns (uint256 id) {
        require(bytes(symbol).length > 0, "TradeJournal: empty symbol");
        require(amount > 0, "TradeJournal: zero amount");
        require(price > 0, "TradeJournal: zero price");
        id = tradeCount;
        trades[id] = Trade({
            symbol: symbol,
            isBuy: isBuy,
            amount: amount,
            price: price,
            reasonHash: reasonHash,
            timestamp: block.timestamp
        });
        tradeCount = id + 1;
        emit TradeRecorded(id, symbol, isBuy, amount, price, reasonHash, block.timestamp);
    }

    function getTrade(uint256 id) external view returns (Trade memory) {
        require(id < tradeCount, "TradeJournal: unknown id");
        return trades[id];
    }
}
