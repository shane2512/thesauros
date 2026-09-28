// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockPriceFeed — owner-set price + publish timestamp for the depeg / freshness demo (V-13 fallback).
/// @notice Testnet only, used only when DEMO_MODE=true on chain 84532 (I11). The price is integer
///         micro-USD (6 decimals, I12): $1.00 == 1_000_000. `updatedAt` is settable so the staleness
///         rule (R12, max age 60 s) can be exercised without waiting.
contract MockPriceFeed is Ownable {
    error StalenessInFuture();

    event PriceSet(uint256 microUsd, uint256 updatedAt);

    uint8 public constant decimals = 6;
    string public description;

    uint256 public microUsd;
    uint256 public updatedAt;

    constructor(string memory description_, uint256 microUsd_, address owner_) Ownable(owner_) {
        description = description_;
        microUsd = microUsd_;
        updatedAt = block.timestamp;
        emit PriceSet(microUsd_, block.timestamp);
    }

    /// @notice Set the price; publish time becomes now.
    function setPrice(uint256 microUsd_) external onlyOwner {
        microUsd = microUsd_;
        updatedAt = block.timestamp;
        emit PriceSet(microUsd_, block.timestamp);
    }

    /// @notice Set the price with an explicit publish time in the past, to test the freshness rule.
    function setPriceAt(uint256 microUsd_, uint256 updatedAt_) external onlyOwner {
        if (updatedAt_ > block.timestamp) revert StalenessInFuture();
        microUsd = microUsd_;
        updatedAt = updatedAt_;
        emit PriceSet(microUsd_, updatedAt_);
    }

    function latestPrice() external view returns (uint256 microUsd_, uint256 updatedAt_) {
        return (microUsd, updatedAt);
    }
}
