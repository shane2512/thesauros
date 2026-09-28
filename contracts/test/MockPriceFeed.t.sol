// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockPriceFeed} from "../src/MockPriceFeed.sol";

contract MockPriceFeedTest is Test {
    MockPriceFeed internal feed;
    address internal owner = address(0xA11CE);
    address internal stranger = address(0xBAD);

    function setUp() public {
        vm.warp(1_800_000_000);
        feed = new MockPriceFeed("USDC/USD", 1_000_000, owner);
    }

    function test_constructorState() public view {
        assertEq(feed.decimals(), 6);
        assertEq(feed.description(), "USDC/USD");
        assertEq(feed.microUsd(), 1_000_000);
        assertEq(feed.updatedAt(), block.timestamp);
        assertEq(feed.owner(), owner);
    }

    function test_setPriceStampsNow() public {
        vm.warp(block.timestamp + 500);
        vm.prank(owner);
        feed.setPrice(985_000); // 1.5% depeg
        (uint256 p, uint256 at) = feed.latestPrice();
        assertEq(p, 985_000);
        assertEq(at, block.timestamp);
    }

    function test_setPriceAtAllowsStaleTimestampsForFreshnessTests() public {
        uint256 stale = block.timestamp - 3_600;
        vm.prank(owner);
        feed.setPriceAt(1_000_000, stale);
        (, uint256 at) = feed.latestPrice();
        assertEq(at, stale);
    }

    function test_rejectsFutureTimestamp() public {
        vm.prank(owner);
        vm.expectRevert(MockPriceFeed.StalenessInFuture.selector);
        feed.setPriceAt(1_000_000, block.timestamp + 1);
    }

    function test_onlyOwner() public {
        vm.startPrank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        feed.setPrice(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        feed.setPriceAt(1, block.timestamp);
        vm.stopPrank();
    }
}
