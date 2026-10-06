// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console2} from "forge-std/Script.sol";
import {DCPToken} from "../src/DCPToken.sol";
import {GameReserve} from "../src/GameReserve.sol";
import {OpsTreasury} from "../src/OpsTreasury.sol";
import {GameShop} from "../src/GameShop.sol";
import {MockERC20, MockIMDFactory} from "../test/mocks/Mocks.sol";

/// LOCAL / ANVIL ONLY. Deploys the full stack against labelled mock IMD, WETH and factory.
/// Refuses every chain except local 31337. Contains NO broadcast or wallet access. See
/// docs/launch-plan.md for the reviewed sequence.
///   forge script contracts/script/DeployLocal.s.sol
contract DeployLocal is Script {
    struct Config {
        address council;
        address guardian;
        address poster;
        address swarm;
    }

    function run() external {
        deploy(Config(address(0x1111), address(0x2222), address(0x3333), address(0x4444)));
    }

    function deploy(Config memory cfg)
        public
        returns (DCPToken dcp, GameReserve reserve, OpsTreasury treasury, GameShop shop)
    {
        require(block.chainid == 31337, "local only");
        require(
            cfg.council != address(0) && cfg.guardian != address(0) && cfg.poster != address(0)
                && cfg.swarm != address(0),
            "roles"
        );
        // Fixed local fixture identity; unrelated to the caller or an accessible wallet.
        address me = address(0xD3A0);
        vm.startPrank(me);
        MockERC20 imd = new MockERC20("IMD-TEST");
        MockERC20 weth = new MockERC20("WETH-TEST");
        MockIMDFactory factory = new MockIMDFactory(address(imd), me);

        address predicted = vm.computeCreateAddress(me, vm.getNonce(me) + 1);
        reserve = new GameReserve(predicted, cfg.council, cfg.guardian, cfg.poster, 2 days, 1 days, 10, 2_000_000 ether);
        address[] memory to = new address[](3);
        uint256[] memory amt = new uint256[](3);
        (to[0], amt[0]) = (me, 200_000_000 ether);
        (to[1], amt[1]) = (cfg.swarm, 100_000_000 ether);
        (to[2], amt[2]) = (address(reserve), 700_000_000 ether);
        dcp = new DCPToken(to, amt);
        require(address(dcp) == predicted, "prediction");

        dcp.approve(address(factory), 200_000_000 ether);
        uint64 id = factory.launch(address(dcp), 200_000_000 ether, 2_000_000 ether);

        OpsTreasury.Params memory p = OpsTreasury.Params({
            payPerEpoch: 1_000 ether,
            payPerPayment: 250 ether,
            essentialFloor: 500 ether,
            lowRunway: 3_000 ether,
            replenishBelow: 5_000 ether,
            convertPerCall: 1_000_000 ether,
            convertPerEpoch: 3_000_000 ether,
            dustFloor: 10_000 ether,
            slippageBps: 300,
            bounty: 5 ether,
            dcpBuffer: 5_000_000 ether,
            gasReserve: 0.5 ether,
            gasTopUp: 0.05 ether,
            gasLow: 0.02 ether,
            gasPerEpoch: 0.2 ether
        });
        treasury = new OpsTreasury(
            [address(dcp), address(imd), address(weth), address(reserve), address(factory), cfg.council],
            cfg.guardian,
            id,
            2 days,
            [uint256(2_000 ether), 1_000, 20 ether],
            p
        );
        factory.setRequester(id, address(treasury));
        shop = new GameShop(address(dcp), address(reserve), address(treasury), 3_000, 5_000);
        vm.stopPrank();

        console2.log("DCP", address(dcp));
        console2.log("GameReserve", address(reserve));
        console2.log("OpsTreasury", address(treasury));
        console2.log("GameShop", address(shop));
        console2.log("MockIMDFactory", address(factory));
    }
}
