// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDC — a 6-decimal, owner-mintable stand-in for USDC on testnet.
/// @notice DEMO.md anticipates exactly this: "funded with testnet USDC (e.g. 200,000 via MockUSDC if
///         faucet limits are too small — then USDC_ADDRESS points to MockUSDC; banner says DEMO
///         DATA)". Circle's testnet faucet is rate-limited per CDP project, which is not enough to
///         run an unattended loop or a rehearsed demo.
/// @dev Testnet only, and only reachable when `USDC_ADDRESS` is pointed here — which I11 already
///      fences to DEMO_MODE on chain 84532, where the UI shows the DEMO DATA banner. Ownership is a
///      CDP server account (`steward-demo-admin`), so no private key is ever on disk.
///
///      Deliberately minimal: 6 decimals so every micro-USD conversion in the system is unchanged
///      (I12), and `mint` is the only privileged function. No pausing, no blocklist, no permit —
///      nothing that could make a demo behave differently from real USDC in the paths Steward uses
///      (`balanceOf`, `transfer`, `approve`, `transferFrom`).
contract MockUSDC is ERC20, Ownable {
    error ZeroAmount();

    constructor(address owner_) ERC20("Steward Mock USDC", "mUSDC") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Mint `amount` base units to `to`. Owner only.
    function mint(address to, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        _mint(to, amount);
    }
}
