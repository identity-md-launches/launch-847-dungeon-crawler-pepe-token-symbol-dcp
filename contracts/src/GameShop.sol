// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Min, IBurnable} from "./interfaces/IERC20Min.sol";

/// @title GameShop
/// @notice Ownerless DCP sink for in-game purchases (cosmetics, sponsor vanity crates, extra
///         save slots, revives that disqualify the run from the leaderboard). Prices and item
///         delivery are enforced by the game server, which credits an order only after it sees
///         the Purchase event at the configured confirmation depth.
///         Split is immutable: BURN_BPS destroyed, RESERVE_BPS recycled to the GameReserve,
///         remainder to the OpsTreasury.
contract GameShop {
    IERC20Min public immutable dcp;
    address public immutable reserve;
    address public immutable treasury;
    uint256 public immutable BURN_BPS;
    uint256 public immutable RESERVE_BPS;

    mapping(bytes32 => bool) public orderUsed;

    event Purchase(address indexed buyer, bytes32 indexed orderId, uint256 sku, uint256 amount);

    error DuplicateOrder();
    error ZeroAmount();
    error TransferFailed();

    constructor(address dcp_, address reserve_, address treasury_, uint256 burnBps, uint256 reserveBps) {
        require(burnBps + reserveBps <= 10_000, "split");
        dcp = IERC20Min(dcp_);
        reserve = reserve_;
        treasury = treasury_;
        BURN_BPS = burnBps;
        RESERVE_BPS = reserveBps;
    }

    /// @param orderId server-issued order id (hash of account, sku, nonce); one payment per order.
    function purchase(bytes32 orderId, uint256 sku, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (orderUsed[orderId]) revert DuplicateOrder();
        orderUsed[orderId] = true;
        if (!dcp.transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 toBurn = (amount * BURN_BPS) / 10_000;
        uint256 toReserve = (amount * RESERVE_BPS) / 10_000;
        if (toBurn > 0) IBurnable(address(dcp)).burn(toBurn);
        if (toReserve > 0 && !dcp.transfer(reserve, toReserve)) revert TransferFailed();
        if (!dcp.transfer(treasury, amount - toBurn - toReserve)) revert TransferFailed();
        emit Purchase(msg.sender, orderId, sku, amount);
    }
}
