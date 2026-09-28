// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockVault} from "../src/MockVault.sol";

/// Local stand-in for Base Sepolia USDC (6 decimals). Only used inside these unit tests — production
/// and the deploy script use the real Circle testnet USDC (V-06), never a mock token.
contract TestUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockVaultTest is Test {
    TestUSDC internal usdc;
    MockVault internal vault;

    address internal owner = address(0xA11CE);
    address internal agent = address(0xB0B);
    address internal stranger = address(0xBAD);

    uint256 internal constant ONE = 1e6; // 1 USDC

    function setUp() public {
        usdc = new TestUSDC();
        vault = new MockVault(IERC20(address(usdc)), "Steward Mock Vault", "svUSDC", owner);
        usdc.mint(agent, 1_000 * ONE);
        usdc.mint(owner, 1_000 * ONE);
        vm.prank(owner);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 assets) internal returns (uint256 shares) {
        vm.startPrank(who);
        usdc.approve(address(vault), assets);
        shares = vault.deposit(assets, who);
        vm.stopPrank();
    }

    function test_metadata() public view {
        assertEq(vault.asset(), address(usdc));
        assertEq(vault.decimals(), 6, "share decimals follow the asset");
        assertEq(vault.owner(), owner);
        assertEq(vault.symbol(), "svUSDC");
    }

    function test_depositAndWithdrawRoundTrip() public {
        uint256 shares = _deposit(agent, 100 * ONE);
        assertEq(shares, 100 * ONE, "1:1 at an empty vault");
        assertEq(vault.totalAssets(), 100 * ONE);
        assertEq(vault.convertToAssets(shares), 100 * ONE);

        vm.prank(agent);
        vault.withdraw(40 * ONE, agent, agent);
        assertEq(usdc.balanceOf(agent), 1_000 * ONE - 60 * ONE);
        assertEq(vault.convertToAssets(vault.balanceOf(agent)), 60 * ONE);
    }

    // --- share-price math -------------------------------------------------

    function test_simulateYieldRaisesSharePrice() public {
        uint256 shares = _deposit(agent, 100 * ONE);
        uint256 before = vault.convertToAssets(10 ** vault.decimals());
        assertEq(before, ONE, "1 share == 1 USDC before yield");

        vm.prank(owner);
        vault.simulateYield(10 * ONE); // +10%

        assertEq(vault.totalAssets(), 110 * ONE);
        // OZ 5.x ERC4626 adds one virtual asset/share to blunt inflation attacks, so conversions round
        // down by at most 1 base unit (1e-6 USDC). The read models must tolerate the same 1-unit dust.
        assertApproxEqAbs(vault.convertToAssets(10 ** vault.decimals()), 1.1e6, 1, "share price +10%");
        assertApproxEqAbs(vault.convertToAssets(shares), 110 * ONE, 1, "holder gains the whole donation");

        // and the gain is really redeemable (the vault is solvent, not virtually credited)
        vm.prank(agent);
        uint256 assetsOut = vault.redeem(shares, agent, agent);
        assertApproxEqAbs(assetsOut, 110 * ONE, 1);
        assertApproxEqAbs(usdc.balanceOf(agent), 1_000 * ONE + 10 * ONE, 1);
    }

    function test_simulateLossLowersSharePrice() public {
        uint256 shares = _deposit(agent, 100 * ONE);

        vm.prank(owner);
        uint256 moved = vault.simulateLoss(2_500); // -25%

        assertEq(moved, 25 * ONE);
        assertEq(vault.totalAssets(), 75 * ONE);
        assertApproxEqAbs(vault.convertToAssets(10 ** vault.decimals()), 0.75e6, 1, "share price -25%");
        assertApproxEqAbs(vault.convertToAssets(shares), 75 * ONE, 1);
        assertEq(usdc.balanceOf(owner), 1_000 * ONE + 25 * ONE, "loss lands with the owner, re-donatable");

        vm.prank(agent);
        assertApproxEqAbs(vault.redeem(shares, agent, agent), 75 * ONE, 1, "still redeemable at the lower price");
    }

    function test_lossThenYieldRestoresPrice() public {
        _deposit(agent, 100 * ONE);
        vm.startPrank(owner);
        uint256 moved = vault.simulateLoss(2_500);
        vault.simulateYield(moved);
        vm.stopPrank();
        assertApproxEqAbs(vault.convertToAssets(10 ** vault.decimals()), ONE, 1);
    }

    function test_secondDepositorPaysCurrentSharePrice() public {
        _deposit(agent, 100 * ONE);
        vm.prank(owner);
        vault.simulateYield(100 * ONE); // share price = 2.0

        uint256 shares = _deposit(stranger_funded(), 50 * ONE);
        assertApproxEqAbs(shares, 25 * ONE, 1, "50 USDC at 2.0 USDC/share == 25 shares");
    }

    function stranger_funded() internal returns (address) {
        usdc.mint(stranger, 100 * ONE);
        return stranger;
    }

    function testFuzz_sharePriceMonotonic(uint96 deposit_, uint96 yield_) public {
        uint256 d = uint256(deposit_) % (1_000_000 * ONE) + ONE;
        uint256 y = uint256(yield_) % (1_000_000 * ONE) + 1;
        usdc.mint(agent, d);
        usdc.mint(owner, y);
        uint256 shares = _deposit(agent, d);
        uint256 priceBefore = vault.convertToAssets(10 ** vault.decimals());
        vm.prank(owner);
        vault.simulateYield(y);
        assertGe(vault.convertToAssets(10 ** vault.decimals()), priceBefore);
        assertGe(vault.convertToAssets(shares) + 1, d, "a holder never loses value from donated yield");
    }

    // --- access control ---------------------------------------------------

    function test_onlyOwnerCanSimulateYield() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.simulateYield(ONE);
    }

    function test_onlyOwnerCanSimulateLoss() public {
        _deposit(agent, 100 * ONE);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.simulateLoss(100);
    }

    function test_rejectsZeroAndOutOfRangeArguments() public {
        vm.startPrank(owner);
        vm.expectRevert(MockVault.ZeroAmount.selector);
        vault.simulateYield(0);
        vm.expectRevert(MockVault.ZeroAmount.selector);
        vault.simulateLoss(0);
        vm.expectRevert(abi.encodeWithSelector(MockVault.BpsTooHigh.selector, uint256(10_001)));
        vault.simulateLoss(10_001);
        // empty vault: loss rounds to zero and is rejected rather than silently doing nothing
        vm.expectRevert(MockVault.ZeroAmount.selector);
        vault.simulateLoss(10_000);
        vm.stopPrank();
    }

    function test_agentCannotWithdrawSomeoneElsesShares() public {
        _deposit(agent, 100 * ONE);
        vm.prank(stranger);
        vm.expectRevert();
        vault.withdraw(10 * ONE, stranger, agent);
    }
}
