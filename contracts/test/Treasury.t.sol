// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {OpsTreasury} from "../src/OpsTreasury.sol";
import {TimelockedRoles} from "../src/TimelockedRoles.sol";

contract TreasuryTest is Base {
    function _fundImd(uint256 a) internal {
        imd.mint(address(treasury), a);
    }

    function test_PayWorkHappyPathAndDuplicateInvoice() public {
        _fundImd(10_000 ether);
        vm.prank(signer);
        treasury.payWork(workPayee, 200 ether, "inv-1");
        assertEq(imd.balanceOf(workPayee), 200 ether);
        vm.prank(signer);
        vm.expectRevert(OpsTreasury.DuplicateInvoice.selector);
        treasury.payWork(workPayee, 200 ether, "inv-1");
    }

    function test_PayWorkAuthority() public {
        _fundImd(10_000 ether);
        vm.prank(attacker);
        vm.expectRevert(OpsTreasury.NotSigner.selector);
        treasury.payWork(workPayee, 1 ether, "x");
        vm.prank(signer);
        vm.expectRevert(OpsTreasury.NotPayee.selector);
        treasury.payWork(attacker, 1 ether, "x");
        vm.prank(council);
        vm.expectRevert(OpsTreasury.NotSigner.selector);
        treasury.payWork(workPayee, 1 ether, "x");
    }

    function test_PayWorkCapsAndLowRunway() public {
        _fundImd(10_000 ether);
        vm.startPrank(signer);
        vm.expectRevert(OpsTreasury.OverCap.selector);
        treasury.payWork(workPayee, 251 ether, "big");
        for (uint256 i; i < 4; ++i) {
            treasury.payWork(workPayee, 250 ether, bytes32(i + 1));
        }
        vm.expectRevert(OpsTreasury.OverCap.selector);
        treasury.payWork(workPayee, 1 ether, "over-epoch");
        vm.stopPrank();

        // New epoch, low runway (< 3000): cap halves to 500.
        vm.warp(block.timestamp + 1 days);
        assertEq(imd.balanceOf(address(treasury)), 9_000 ether);
        vm.prank(address(treasury));
        imd.transfer(address(0xdead), 6_500 ether); // simulate depleted runway
        vm.startPrank(signer);
        treasury.payWork(workPayee, 250 ether, "a");
        treasury.payWork(workPayee, 250 ether, "b");
        vm.expectRevert(OpsTreasury.OverCap.selector);
        treasury.payWork(workPayee, 1 ether, "c");
        vm.stopPrank();
    }

    function test_EssentialFloorProtected() public {
        _fundImd(600 ether);
        vm.prank(signer);
        vm.expectRevert(OpsTreasury.BelowFloor.selector);
        treasury.payWork(workPayee, 101 ether, "f");
        vm.prank(signer);
        treasury.payWork(workPayee, 100 ether, "g");
    }

    function testFuzz_NeverOverspendEpoch(uint256[8] memory amts) public {
        _fundImd(100_000 ether);
        uint256 spent;
        for (uint256 i; i < amts.length; ++i) {
            uint256 a = bound(amts[i], 0, 400 ether);
            vm.prank(signer);
            try treasury.payWork(workPayee, a, bytes32(i)) {
                spent += a;
            } catch {}
        }
        assertLe(spent, 1_000 ether);
        assertEq(imd.balanceOf(workPayee), spent);
    }

    function test_ConvertDcpFeesWhenRunwayLow() public {
        vm.prank(swarm);
        dcp.transfer(address(treasury), 2_000_000 ether);
        uint256 fair = oracle.quote(address(dcp), address(imd), 1_000_000 ether);
        vm.prank(keeper);
        uint256 out = treasury.convert(address(dcp), 1_000_000 ether, (fair * 9_800) / 10_000);
        assertEq(out, fair);
        assertEq(imd.balanceOf(keeper), 5 ether, "bounded keeper bounty");
        assertEq(imd.balanceOf(address(treasury)), fair - 5 ether);
    }

    function test_ConvertRejectsLowMinOutAndPreservesFundsOnFailure() public {
        vm.prank(swarm);
        dcp.transfer(address(treasury), 2_000_000 ether);
        uint256 fair = oracle.quote(address(dcp), address(imd), 1_000_000 ether);

        vm.expectRevert(OpsTreasury.MinOutTooLow.selector);
        treasury.convert(address(dcp), 1_000_000 ether, 0); // sandwich attempt

        adapter.set(address(dcp), 0.001 ether, 1_000, false); // pool 10% worse than TWAP
        vm.expectRevert();
        treasury.convert(address(dcp), 1_000_000 ether, (fair * 9_800) / 10_000);
        assertEq(dcp.balanceOf(address(treasury)), 2_000_000 ether, "funds preserved");

        adapter.set(address(dcp), 0.001 ether, 1_000, true); // lying router
        vm.expectRevert(OpsTreasury.ShortOutput.selector);
        treasury.convert(address(dcp), 1_000_000 ether, (fair * 9_800) / 10_000);
        assertEq(dcp.balanceOf(address(treasury)), 2_000_000 ether, "funds preserved");
        assertEq(dcp.allowance(address(treasury), address(adapter)), 0);
    }

    function test_ConvertCapsDustAndRunwayGate() public {
        vm.prank(swarm);
        dcp.transfer(address(treasury), 10_000_000 ether);
        vm.expectRevert(OpsTreasury.Dust.selector);
        treasury.convert(address(dcp), 1 ether, 0);
        vm.expectRevert(OpsTreasury.OverCap.selector);
        treasury.convert(address(dcp), 1_000_001 ether, type(uint256).max);
        vm.expectRevert(OpsTreasury.BadAsset.selector);
        treasury.convert(address(imd), 1_000_000 ether, 0);

        _fundImd(5_000 ether); // runway healthy
        vm.expectRevert(OpsTreasury.NotNeeded.selector);
        treasury.convert(address(dcp), 1_000_000 ether, 1_000 ether);
    }

    function test_ConvertEpochCap() public {
        vm.prank(swarm);
        dcp.transfer(address(treasury), 10_000_000 ether);
        // replenishBelow is 5000 IMD; each convert yields ~1000 IMD so three fit before the gate.
        for (uint256 i; i < 3; ++i) {
            treasury.convert(address(dcp), 1_000_000 ether, 980 ether);
        }
        vm.expectRevert();
        treasury.convert(address(dcp), 1_000_000 ether, 980 ether);
    }

    function test_RecycleExcessDcpToReserve() public {
        vm.prank(swarm);
        dcp.transfer(address(treasury), 8_000_000 ether);
        vm.prank(attacker);
        treasury.recycleDcp();
        assertEq(dcp.balanceOf(address(treasury)), 5_000_000 ether);
        assertEq(dcp.balanceOf(address(reserve)), RESERVE + 3_000_000 ether);
    }

    function test_GasTopUpBounded() public {
        vm.deal(address(treasury), 1 ether);
        vm.deal(keeper, 0);
        treasury.topUpGas(keeper);
        assertEq(keeper.balance, 0.05 ether);
        vm.expectRevert(OpsTreasury.NotNeeded.selector);
        treasury.topUpGas(keeper);
        vm.expectRevert(OpsTreasury.NotPayee.selector);
        treasury.topUpGas(attacker);
    }

    function test_FreezeStopsSpendingAndNeedsTimelockToLift() public {
        _fundImd(10_000 ether);
        vm.prank(attacker);
        vm.expectRevert(TimelockedRoles.NotGuardian.selector);
        treasury.freeze();
        vm.prank(guardian);
        treasury.freeze();
        vm.prank(signer);
        vm.expectRevert(OpsTreasury.IsFrozen.selector);
        treasury.payWork(workPayee, 1 ether, "z");
        _timelock(address(treasury), abi.encodeCall(OpsTreasury.unfreeze, ()));
        vm.prank(signer);
        treasury.payWork(workPayee, 1 ether, "z");
    }

    function test_TreasuryAttacksFail() public {
        _fundImd(10_000 ether);
        // Council cannot route funds via the timelock: token transfer selector doesn't exist here.
        bytes memory steal = abi.encodeWithSignature("transfer(address,uint256)", attacker, 1);
        vm.prank(council);
        treasury.queue(steal);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert();
        treasury.execute(steal);

        // Parameter changes are bounded by deploy-time hard limits.
        OpsTreasury.Params memory p = _params();
        p.payPerEpoch = 1_000_000 ether;
        bytes memory bad = abi.encodeCall(OpsTreasury.setParams, (p));
        vm.prank(council);
        treasury.queue(bad);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert();
        treasury.execute(bad);

        // Guardian can cancel a malicious queued payee change.
        bytes memory evil = abi.encodeCall(OpsTreasury.setPayee, (attacker, true));
        vm.prank(council);
        treasury.queue(evil);
        vm.prank(guardian);
        treasury.cancel(keccak256(evil));
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(TimelockedRoles.NotQueued.selector);
        treasury.execute(evil);

        // Direct config calls are rejected.
        vm.prank(council);
        vm.expectRevert(TimelockedRoles.NotSelf.selector);
        treasury.setPaymentSigner(attacker);
        assertEq(imd.balanceOf(attacker), 0);
    }

    function test_EndToEndFeeToTreasuryToPaidWork() public {
        // Players trade; fees accrue; anyone harvests; IMD pays an invoice for content work.
        for (uint256 i; i < 10; ++i) {
            _trade(makeAddr(string(abi.encode(i))), true, 50_000 ether);
        }
        treasury.harvest();
        uint256 bal = imd.balanceOf(address(treasury));
        assertEq(bal, 5_000 ether);
        vm.prank(signer);
        treasury.payWork(workPayee, 250 ether, keccak256("content-cycle-1"));
        assertEq(imd.balanceOf(workPayee), 250 ether);
    }
}
