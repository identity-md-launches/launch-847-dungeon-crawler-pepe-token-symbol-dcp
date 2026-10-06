// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPrizeRandomness} from "./interfaces/IPrizeRandomness.sol";

/// ABI-compatible subset of Chainlink VRF v2.5's coordinator interface.
/// Coordinator, subscription, gas lane and confirmations must be verified at the later launch.
interface IVRFCoordinator {
    struct Request {
        bytes32 keyHash;
        uint256 subId;
        uint16 requestConfirmations;
        uint32 callbackGasLimit;
        uint32 numWords;
        bytes extraArgs;
    }
    function requestRandomWords(Request calldata request) external returns (uint256 requestId);
}

/// @notice Immutable VRF consumer; no owner, withdrawal, reroll, cancellation or provider rotation.
/// The subscription is externally funded and must authorize this consumer. Creating or funding
/// a subscription is NOT part of the build. Tests use a labelled coordinator fixture.
contract VRFPrizeSource is IPrizeRandomness {
    address public immutable reserve;
    IVRFCoordinator public immutable coordinator;
    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint16 public immutable confirmations;
    uint32 public constant CALLBACK_GAS = 150_000;
    bytes4 private constant EXTRA_ARGS_V1 = bytes4(keccak256("VRF ExtraArgsV1"));

    mapping(uint256 => uint256) public requestEpoch;
    mapping(uint256 => bool) public requested;
    mapping(uint256 => bool) private fulfilled;
    mapping(uint256 => bytes32) private words;

    error Unauthorized();
    error AlreadyRequested();
    event Requested(uint256 indexed epoch, uint256 indexed requestId);
    event Fulfilled(uint256 indexed epoch, uint256 indexed requestId, bytes32 word);

    constructor(address reserve_, address coordinator_, bytes32 keyHash_, uint256 subId_, uint16 confirmations_) {
        require(reserve_ != address(0) && coordinator_.code.length > 0, "invalid address");
        require(keyHash_ != bytes32(0) && confirmations_ >= 3, "invalid VRF config");
        reserve = reserve_;
        coordinator = IVRFCoordinator(coordinator_);
        keyHash = keyHash_;
        subscriptionId = subId_;
        confirmations = confirmations_;
    }

    function request(uint256 epoch) external {
        if (msg.sender != reserve) revert Unauthorized();
        if (epoch == 0 || requested[epoch]) revert AlreadyRequested();
        requested[epoch] = true;
        uint256 id = coordinator.requestRandomWords(
            IVRFCoordinator.Request({
                keyHash: keyHash,
                subId: subscriptionId,
                requestConfirmations: confirmations,
                callbackGasLimit: CALLBACK_GAS,
                numWords: 1,
                extraArgs: abi.encodeWithSelector(EXTRA_ARGS_V1, true)
            })
        );
        require(requestEpoch[id] == 0, "duplicate request id");
        requestEpoch[id] = epoch;
        emit Requested(epoch, id);
    }

    /// Only the coordinator may supply proof-verified words. Store only, with no external calls.
    function rawFulfillRandomWords(uint256 requestId, uint256[] calldata randomWords) external {
        if (msg.sender != address(coordinator)) revert Unauthorized();
        uint256 epoch = requestEpoch[requestId];
        if (epoch == 0 || fulfilled[epoch] || randomWords.length != 1) return;
        fulfilled[epoch] = true;
        words[epoch] = bytes32(randomWords[0]);
        emit Fulfilled(epoch, requestId, words[epoch]);
    }

    function result(uint256 epoch) external view returns (bool, bytes32) {
        return (fulfilled[epoch], words[epoch]);
    }
}
