// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Swap route used by OpsTreasury. The production implementation must target a route
///         verified at launch time (see docs/launch-readiness.md); none is assumed here.
interface ISwapAdapter {
    /// @dev Pulls exactly `amountIn` of `tokenIn` from msg.sender, sends >= `minOut` of
    ///      `tokenOut` to `to`, or reverts.
    function swapExactIn(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 amountOut);
}

/// @notice Manipulation-resistant price source (e.g. a >=30 min TWAP). Returns how much
///         `tokenOut` `amountIn` of `tokenIn` is worth, and reverts if the observation is stale.
interface IPriceOracle {
    function quote(address tokenIn, address tokenOut, uint256 amountIn) external view returns (uint256 amountOut);
}

/// @notice The subset of the IMD launch factory this project relies on. Signatures follow the
///         task brief; they are NOT verified against deployed bytecode (see launch-readiness).
interface IIMDFactory {
    function setRequester(uint64 launchId, address requester) external;
    function claimFees(uint64 launchId) external;
    function withdraw(uint64 launchId) external;
}
