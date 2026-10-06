// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// A source must authenticate a verifiable randomness coordinator, bind each result to one
/// request, never permit rerolls, and retain fulfilled results without expiration.
interface IPrizeRandomness {
    function request(uint256 epoch) external;
    function result(uint256 epoch) external view returns (bool fulfilled, bytes32 word);
}
