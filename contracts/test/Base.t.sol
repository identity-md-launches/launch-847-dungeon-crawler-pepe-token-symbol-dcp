// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {DCPToken} from "../src/DCPToken.sol";
import {GameReserve} from "../src/GameReserve.sol";
import {OpsTreasury} from "../src/OpsTreasury.sol";
import {GameShop} from "../src/GameShop.sol";
import {MockERC20, MockIMDFactory, MockOracle, MockSwapAdapter} from "./mocks/Mocks.sol";

/// Shared local deployment mirroring docs/launch-plan.md, using labelled test fixtures for IMD,
/// WETH, the factory, oracle and swap route.
abstract contract Base is Test {
    uint256 constant SUPPLY = 1_000_000_000 ether;
    uint256 constant POOL = 200_000_000 ether; // 20%
    uint256 constant SWARM = 100_000_000 ether; // 10%
    uint256 constant RESERVE = 700_000_000 ether; // 70%

    address launcher = makeAddr("launcher");
    address swarm = makeAddr("swarmEscrow");
    address council = makeAddr("councilSafe");
    address guardian = makeAddr("guardianSafe");
    address poster = makeAddr("prizePoster");
    address signer = makeAddr("paymentSigner");
    address workPayee = makeAddr("imdPaidWork");
    address keeper = makeAddr("keeperEoa");
    address imdProtocol = makeAddr("imdProtocol");
    address attacker = makeAddr("attacker");

    MockERC20 imd;
    MockERC20 weth;
    MockIMDFactory factory;
    MockOracle oracle;
    MockSwapAdapter adapter;
    DCPToken dcp;
    GameReserve reserve;
    OpsTreasury treasury;
    GameShop shop;
    uint64 launchId;

    function _params() internal pure returns (OpsTreasury.Params memory p) {
        p.payPerEpoch = 1_000 ether;
        p.payPerPayment = 250 ether;
        p.essentialFloor = 500 ether;
        p.lowRunway = 3_000 ether;
        p.replenishBelow = 5_000 ether;
        p.convertPerCall = 1_000_000 ether;
        p.convertPerEpoch = 3_000_000 ether;
        p.dustFloor = 10_000 ether;
        p.slippageBps = 300;
        p.bounty = 5 ether;
        p.dcpBuffer = 5_000_000 ether;
        p.gasReserve = 0.5 ether;
        p.gasTopUp = 0.05 ether;
        p.gasLow = 0.02 ether;
        p.gasPerEpoch = 0.2 ether;
    }

    function setUp() public virtual {
        imd = new MockERC20("IMD");
        weth = new MockERC20("WETH");
        factory = new MockIMDFactory(address(imd), imdProtocol);
        oracle = new MockOracle();
        adapter = new MockSwapAdapter(address(imd));

        // Reserve must exist before the token so it receives its allocation at mint.
        address predictedToken = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        reserve = new GameReserve(predictedToken, council, guardian, poster, 2 days, 1 days, 10, 2_000_000 ether);

        address[] memory to = new address[](3);
        uint256[] memory amt = new uint256[](3);
        (to[0], amt[0]) = (launcher, POOL);
        (to[1], amt[1]) = (swarm, SWARM);
        (to[2], amt[2]) = (address(reserve), RESERVE);
        dcp = new DCPToken(to, amt);
        assertEq(address(dcp), predictedToken);

        // Single-sided seed: only DCP goes in; the requester funds no pair liquidity.
        vm.startPrank(launcher);
        dcp.approve(address(factory), POOL);
        launchId = factory.launch(address(dcp), POOL, 2_000_000 ether);
        vm.stopPrank();

        treasury = new OpsTreasury(
            [address(dcp), address(imd), address(weth), address(reserve), address(factory), council],
            guardian,
            launchId,
            2 days,
            [uint256(2_000 ether), 1_000, 20 ether],
            _params()
        );
        vm.prank(launcher);
        factory.setRequester(launchId, address(treasury));

        shop = new GameShop(address(dcp), address(reserve), address(treasury), 3_000, 5_000);

        _timelock(address(treasury), abi.encodeCall(OpsTreasury.setPaymentSigner, (signer)));
        _timelock(address(treasury), abi.encodeCall(OpsTreasury.setPayee, (workPayee, true)));
        _timelock(address(treasury), abi.encodeCall(OpsTreasury.setGasOperator, (keeper, true)));
        _timelock(address(treasury), abi.encodeCall(OpsTreasury.setRoute, (address(adapter), address(oracle))));

        oracle.set(address(dcp), 0.001 ether);
        oracle.set(address(weth), 2_000 ether);
        adapter.set(address(dcp), 0.001 ether, 0, false);
        adapter.set(address(weth), 2_000 ether, 0, false);
    }

    function _timelock(address target, bytes memory data) internal {
        vm.prank(council);
        (bool ok,) = target.call(abi.encodeWithSignature("queue(bytes)", data));
        require(ok, "queue");
        vm.warp(block.timestamp + 2 days);
        (ok,) = target.call(abi.encodeWithSignature("execute(bytes)", data));
        require(ok, "execute");
    }

    function _trade(address who, bool buy, uint256 amount) internal returns (uint256) {
        vm.startPrank(who);
        if (buy) {
            imd.mint(who, amount);
            imd.approve(address(factory), amount);
        } else {
            dcp.approve(address(factory), amount);
        }
        uint256 out = factory.swap(launchId, buy, amount);
        vm.stopPrank();
        return out;
    }
}
