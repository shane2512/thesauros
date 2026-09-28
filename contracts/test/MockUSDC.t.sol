// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract MockUSDCTest is Test {
    MockUSDC internal token;
    address internal owner = address(0xA11CE);
    address internal alice = address(0xB0B);

    function setUp() public {
        token = new MockUSDC(owner);
    }

    /// Six decimals is load-bearing: every limit in Steward is micro-USD (I12).
    function test_decimals_matchUsdc() public view {
        assertEq(token.decimals(), 6);
        assertEq(token.symbol(), "mUSDC");
    }

    function test_ownerCanMint() public {
        vm.prank(owner);
        token.mint(alice, 200_000e6);
        assertEq(token.balanceOf(alice), 200_000e6);
        assertEq(token.totalSupply(), 200_000e6);
    }

    function test_nonOwnerCannotMint() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1e6);
    }

    function test_zeroMintReverts() public {
        vm.prank(owner);
        vm.expectRevert(MockUSDC.ZeroAmount.selector);
        token.mint(alice, 0);
    }

    /// The four ERC-20 entry points Steward actually uses must behave like USDC.
    function test_transferAndApproveBehaveLikeUsdc() public {
        vm.prank(owner);
        token.mint(alice, 10e6);

        vm.prank(alice);
        assertTrue(token.transfer(owner, 4e6));
        assertEq(token.balanceOf(alice), 6e6);

        vm.prank(alice);
        assertTrue(token.approve(owner, 6e6));
        assertEq(token.allowance(alice, owner), 6e6);

        vm.prank(owner);
        assertTrue(token.transferFrom(alice, owner, 6e6));
        assertEq(token.balanceOf(alice), 0);
        assertEq(token.allowance(alice, owner), 0);
    }
}
