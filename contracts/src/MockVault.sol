// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockVault — a plain ERC-4626 vault over real testnet USDC, with owner-driven share-price moves.
/// @notice Demo/testnet only. Two owner-only knobs move the share price:
///         - `simulateYield(amount)`  pulls `amount` of the underlying asset FROM THE OWNER into the vault,
///           so total assets (and therefore the share price) rise. The owner must hold the USDC and have
///           approved this vault. Yield is real, donated value — the vault is always fully solvent.
///         - `simulateLoss(bps)`      sends `totalAssets * bps / 10_000` of the underlying OUT to the owner,
///           so the share price drops. The owner can re-donate it later via `simulateYield`.
///         Both are deliberately *asset transfers* rather than an accounting offset: the underlying is real
///         USDC that this contract does not mint, so a virtual-assets offset would make the vault insolvent
///         and break redemptions — exactly the code path the demo needs to exercise.
/// @dev Ownership is held by a CDP server account (`steward-demo-admin`), so demo scripts can call these
///      without any private key on disk.
contract MockVault is ERC4626, Ownable {
    error ZeroAmount();
    error BpsTooHigh(uint256 bps);

    event YieldSimulated(uint256 amount, uint256 totalAssetsAfter);
    event LossSimulated(uint256 bps, uint256 amount, uint256 totalAssetsAfter);

    uint256 private constant MAX_BPS = 10_000;

    constructor(IERC20 asset_, string memory name_, string memory symbol_, address owner_)
        ERC20(name_, symbol_)
        ERC4626(asset_)
        Ownable(owner_)
    {}

    // OZ's ERC4626.decimals() is already `underlyingDecimals + _decimalsOffset()` = 6 + 0 for USDC, so
    // `convertToAssets(10 ** decimals())` reads directly as "assets per whole share" in base units.

    /// @notice Donate `amount` of the underlying from the caller (owner) into the vault, raising the share price.
    function simulateYield(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        SafeERC20.safeTransferFrom(IERC20(asset()), msg.sender, address(this), amount);
        emit YieldSimulated(amount, totalAssets());
    }

    /// @notice Move `bps` of total assets out to the owner, lowering the share price.
    function simulateLoss(uint256 bps) external onlyOwner returns (uint256 amount) {
        if (bps == 0) revert ZeroAmount();
        if (bps > MAX_BPS) revert BpsTooHigh(bps);
        amount = (totalAssets() * bps) / MAX_BPS;
        if (amount == 0) revert ZeroAmount();
        SafeERC20.safeTransfer(IERC20(asset()), owner(), amount);
        emit LossSimulated(bps, amount, totalAssets());
    }
}
