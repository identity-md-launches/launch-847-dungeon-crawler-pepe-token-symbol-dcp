// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base} from "./Base.t.sol";
import {GameReserve} from "../src/GameReserve.sol";
import {TimelockedRoles} from "../src/TimelockedRoles.sol";

contract ReserveTest is Base {
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 seed = keccak256("server-seed-epoch");
    uint256 E; // first epoch that can still be committed

    function setUp() public override {
        super.setUp();
        E = reserve.currentEpoch() + 1;
    }

    function _leaf(uint256 i, address a, uint256 amt) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(i, a, amt))));
    }

    function _pair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }

    /// Runs the full commit → anchor → reveal → post cycle for epoch `e` with two leaves.
    function _round(uint256 e, uint256 aAmt, uint256 bAmt) internal returns (bytes32 la, bytes32 lb) {
        vm.prank(poster);
        reserve.commitSeed(e, keccak256(abi.encodePacked(seed)));
        vm.warp(reserve.GENESIS() + e * 1 days + 1);
        reserve.anchor(e);
        vm.roll(block.number + 2);
        vm.prank(poster);
        reserve.revealSeed(e, seed);
        la = _leaf(0, alice, aAmt);
        lb = _leaf(1, bob, bAmt);
        vm.prank(poster);
        reserve.postRoot(e, _pair(la, lb), aAmt + bAmt);
    }

    function _proof(bytes32 x) internal pure returns (bytes32[] memory p) {
        p = new bytes32[](1);
        p[0] = x;
    }

    function test_FullCycleClaimOnceToLeafAccount() public {
        (bytes32 la, bytes32 lb) = _round(E, 100 ether, 50 ether);
        (,, bytes32 rnd,,,,,) = reserve.rounds(E);
        assertTrue(rnd != bytes32(0));
        assertEq(reserve.outstanding(), 150 ether);

        vm.expectRevert(GameReserve.InWindow.selector);
        reserve.claim(E, 0, alice, 100 ether, _proof(lb));

        vm.warp(block.timestamp + 1 days);
        vm.prank(attacker); // anyone may submit; funds still go to alice
        reserve.claim(E, 0, alice, 100 ether, _proof(lb));
        assertEq(dcp.balanceOf(alice), 100 ether);
        assertEq(dcp.balanceOf(attacker), 0);

        vm.expectRevert(GameReserve.AlreadyClaimed.selector);
        reserve.claim(E, 0, alice, 100 ether, _proof(lb));

        // Redirecting a leaf to the attacker fails the proof.
        vm.expectRevert(GameReserve.BadProof.selector);
        reserve.claim(E, 1, attacker, 50 ether, _proof(la));

        reserve.claim(E, 1, bob, 50 ether, _proof(la));
        assertEq(reserve.outstanding(), 0);
    }

    function test_PostOverCapReverts() public {
        vm.prank(poster);
        reserve.commitSeed(E, keccak256(abi.encodePacked(seed)));
        vm.warp(reserve.GENESIS() + E * 1 days + 1);
        reserve.anchor(E);
        vm.roll(block.number + 2);
        vm.prank(poster);
        reserve.revealSeed(E, seed);
        uint256 cap = reserve.epochCap();
        assertEq(cap, (RESERVE * 10) / 10_000 < 2_000_000 ether ? (RESERVE * 10) / 10_000 : 2_000_000 ether);
        vm.prank(poster);
        vm.expectRevert(GameReserve.OverCap.selector);
        reserve.postRoot(E, bytes32(uint256(1)), cap + 1);
    }

    function test_SeedMustBeCommittedBeforeEpochAndMatch() public {
        vm.prank(poster);
        vm.expectRevert(GameReserve.BadEpoch.selector);
        reserve.commitSeed(E - 1, keccak256(abi.encodePacked(seed))); // current epoch: too late

        vm.prank(poster);
        reserve.commitSeed(E + 1, keccak256(abi.encodePacked(seed)));
        vm.warp(reserve.GENESIS() + (E + 1) * 1 days + 1);
        reserve.anchor(E + 1);
        vm.roll(block.number + 2);
        vm.prank(poster);
        vm.expectRevert(GameReserve.BadSeed.selector);
        reserve.revealSeed(E + 1, keccak256("other"));
    }

    function test_RevealExpiresAfter256Blocks() public {
        vm.prank(poster);
        reserve.commitSeed(E, keccak256(abi.encodePacked(seed)));
        vm.warp(reserve.GENESIS() + E * 1 days + 1);
        reserve.anchor(E);
        vm.roll(block.number + 300);
        vm.prank(poster);
        vm.expectRevert(GameReserve.RevealExpired.selector);
        reserve.revealSeed(E, seed);
    }

    function test_GuardianVetoReleasesLiability() public {
        _round(E, 100 ether, 50 ether);
        vm.prank(attacker);
        vm.expectRevert(TimelockedRoles.NotGuardian.selector);
        reserve.veto(E);
        vm.prank(guardian);
        reserve.veto(E);
        assertEq(reserve.outstanding(), 0);
        vm.warp(block.timestamp + 2 days);
        vm.expectRevert(GameReserve.Vetoed.selector);
        reserve.claim(E, 0, alice, 100 ether, new bytes32[](0));
    }

    function test_DormancyKeepsFinalClaims() public {
        (, bytes32 lb) = _round(E, 100 ether, 50 ether);
        _timelock(address(reserve), abi.encodeCall(GameReserve.setPoster, (address(0))));
        assertEq(reserve.poster(), address(0));
        reserve.claim(E, 0, alice, 100 ether, _proof(lb));
        assertEq(dcp.balanceOf(alice), 100 ether);
    }

    function test_NoWithdrawPathForCouncil() public {
        bytes memory steal = abi.encodeWithSignature("transfer(address,uint256)", attacker, RESERVE);
        vm.prank(council);
        reserve.queue(steal);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert();
        reserve.execute(steal);
        assertEq(dcp.balanceOf(address(reserve)), RESERVE);
        vm.prank(attacker);
        vm.expectRevert(TimelockedRoles.NotCouncil.selector);
        reserve.queue(abi.encodeCall(GameReserve.setPoster, (attacker)));
    }

    /// Geometric emission: even a compromised poster posting the maximum every day for 5 years
    /// leaves most of the reserve, and outstanding never exceeds the balance.
    function test_MaxEmissionNeverEmptiesReserve() public {
        uint256 posted;
        for (uint256 e = E; e < E + 5 * 365; e += 30) {
            vm.prank(poster);
            reserve.commitSeed(e, keccak256(abi.encodePacked(seed)));
            vm.warp(reserve.GENESIS() + e * 1 days + 1);
            reserve.anchor(e);
            vm.roll(block.number + 2);
            vm.startPrank(poster);
            reserve.revealSeed(e, seed);
            uint256 cap = reserve.epochCap();
            reserve.postRoot(e, keccak256(abi.encode(e)), cap);
            vm.stopPrank();
            posted += cap;
            assertLe(reserve.outstanding(), dcp.balanceOf(address(reserve)));
        }
        assertLe(posted, RESERVE / 10);
    }

    function test_ClaimManyBatchesAndBlocksDuplicates() public {
        (bytes32 la, bytes32 lb) = _round(E, 100 ether, 50 ether);
        vm.warp(block.timestamp + 1 days);
        GameReserve.ClaimArgs[] memory c = new GameReserve.ClaimArgs[](2);
        c[0] = GameReserve.ClaimArgs(E, 0, alice, 100 ether, _proof(lb));
        c[1] = GameReserve.ClaimArgs(E, 1, bob, 50 ether, _proof(la));
        reserve.claimMany(c);
        assertEq(dcp.balanceOf(alice), 100 ether);
        assertEq(dcp.balanceOf(bob), 50 ether);
        vm.expectRevert(GameReserve.AlreadyClaimed.selector);
        reserve.claimMany(c);
    }

    /// The server's JS Merkle builder must match the contract (vector shared with test/economy.test.mjs).
    function test_LeafEncodingVector() public pure {
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(uint256(7), address(0xBEEF), uint256(25 ether)))));
        assertEq(leaf, 0xb717d7d73203b2deb937bf9d246ead68deb067233a3a75858925c4c799ca3fe8);
    }
}
