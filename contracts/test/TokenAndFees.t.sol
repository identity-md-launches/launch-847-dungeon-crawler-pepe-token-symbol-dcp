// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {DCPToken} from "../src/DCPToken.sol";

contract TokenAndFeesTest is Base {
    function test_SupplyAndAllocationExact() public view {
        assertEq(dcp.totalSupply(), SUPPLY);
        assertEq(dcp.decimals(), 18);
        assertEq(dcp.symbol(), "DCP");
        assertEq(dcp.name(), "Dungeon Crawler Pepe");
        assertEq(dcp.balanceOf(address(reserve)), RESERVE, "reserve gets exact 70%");
        assertEq(dcp.balanceOf(swarm), SWARM, "swarm gets exact 10%");
        assertEq(dcp.balanceOf(address(factory)), POOL, "pool seeded single-sided with 20%");
        assertEq(dcp.balanceOf(launcher), 0);
        assertEq(imd.balanceOf(address(factory)), 0, "no requester-funded IMD liquidity");
    }

    function test_AllocationMustSumToSupply() public {
        address[] memory to = new address[](1);
        uint256[] memory amt = new uint256[](1);
        to[0] = address(1);
        amt[0] = SUPPLY - 1;
        vm.expectRevert(DCPToken.BadAllocation.selector);
        new DCPToken(to, amt);
    }

    function test_NoMintOwnerPauseUpgradeSelectors() public {
        // None of these exist on the token: low-level calls must fail.
        bytes4[6] memory sels = [
            bytes4(keccak256("mint(address,uint256)")),
            bytes4(keccak256("owner()")),
            bytes4(keccak256("pause()")),
            bytes4(keccak256("upgradeTo(address)")),
            bytes4(keccak256("transferOwnership(address)")),
            bytes4(keccak256("setFee(uint256)"))
        ];
        for (uint256 i; i < sels.length; ++i) {
            (bool ok,) = address(dcp).call(abi.encodeWithSelector(sels[i], address(this), 1));
            assertFalse(ok);
        }
    }

    function testFuzz_PlainTransferNoTax(uint256 amt) public {
        amt = bound(amt, 1, SWARM);
        vm.prank(swarm);
        dcp.transfer(attacker, amt);
        assertEq(dcp.balanceOf(attacker), amt);
        assertEq(dcp.totalSupply(), SUPPLY);
    }

    function test_SetRequesterOnlyOnceByLauncher() public {
        vm.prank(attacker);
        vm.expectRevert(bytes("launcher"));
        factory.setRequester(launchId, attacker);
        vm.prank(launcher);
        vm.expectRevert(bytes("set"));
        factory.setRequester(launchId, attacker);
    }

    /// Fees from both directions accrue; anyone harvests; BOTH assets arrive at the treasury in
    /// exactly the documented 1.00% share, IMD protocol gets 0.25%.
    function test_FeesRouteBothAssetsToTreasury() public {
        uint256 buyIn = 1_000 ether;
        uint256 bought = _trade(attacker, true, buyIn);
        uint256 sellIn = bought / 2;
        _trade(attacker, false, sellIn);

        assertEq(imd.balanceOf(imdProtocol), (buyIn * 125) / 10_000 - buyIn / 100);
        assertEq(dcp.balanceOf(imdProtocol), (sellIn * 125) / 10_000 - sellIn / 100);

        vm.prank(makeAddr("randomPoker"));
        treasury.harvest();

        assertEq(imd.balanceOf(address(treasury)), buyIn / 100, "IMD fee arrived");
        assertEq(dcp.balanceOf(address(treasury)), sellIn / 100, "DCP fee arrived");

        // Second harvest is a no-op, not a double payout.
        treasury.harvest();
        assertEq(imd.balanceOf(address(treasury)), buyIn / 100);
    }

    function test_ShopSplitBurnReserveTreasury() public {
        vm.prank(swarm);
        dcp.transfer(attacker, 1_000 ether);
        vm.startPrank(attacker);
        dcp.approve(address(shop), 1_000 ether);
        shop.purchase(keccak256("order-1"), 7, 1_000 ether);
        vm.expectRevert();
        shop.purchase(keccak256("order-1"), 7, 1 ether);
        vm.stopPrank();
        assertEq(dcp.totalSupply(), SUPPLY - 300 ether, "30% burned");
        assertEq(dcp.balanceOf(address(reserve)), RESERVE + 500 ether, "50% recycled");
        assertEq(dcp.balanceOf(address(treasury)), 200 ether, "20% ops");
    }
}
