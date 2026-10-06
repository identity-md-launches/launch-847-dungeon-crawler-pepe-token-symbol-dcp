// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title TimelockedRoles
/// @notice Every configuration change is a call the contract makes to itself, queued by the
///         council and executable only after DELAY. The guardian may cancel queued calls; it can
///         never queue or execute anything. Neither role can move assets: subclasses expose no
///         self-call that transfers funds to an arbitrary address.
abstract contract TimelockedRoles {
    uint256 public immutable DELAY;

    address public council; // expected: Safe multisig of replaceable operators
    address public guardian; // expected: separate Safe; veto/freeze only

    mapping(bytes32 => uint256) public queuedEta;

    event Queued(bytes32 indexed id, bytes data, uint256 eta);
    event Executed(bytes32 indexed id, bytes data);
    event Cancelled(bytes32 indexed id);
    event CouncilChanged(address council);
    event GuardianChanged(address guardian);

    error NotCouncil();
    error NotGuardian();
    error NotSelf();
    error NotQueued();
    error TooEarly();
    error CallFailed(bytes reason);
    error ZeroAddr();

    modifier onlySelf() {
        if (msg.sender != address(this)) revert NotSelf();
        _;
    }

    constructor(address council_, address guardian_, uint256 delay_) {
        if (council_ == address(0) || guardian_ == address(0)) revert ZeroAddr();
        council = council_;
        guardian = guardian_;
        DELAY = delay_;
    }

    function queue(bytes calldata data) external returns (bytes32 id) {
        if (msg.sender != council) revert NotCouncil();
        id = keccak256(data);
        uint256 eta = block.timestamp + DELAY;
        queuedEta[id] = eta;
        emit Queued(id, data, eta);
    }

    /// @notice Anyone may execute a matured queued call (so a lost council key cannot strand
    ///         an already-approved rotation).
    function execute(bytes calldata data) external {
        bytes32 id = keccak256(data);
        uint256 eta = queuedEta[id];
        if (eta == 0) revert NotQueued();
        if (block.timestamp < eta) revert TooEarly();
        delete queuedEta[id];
        (bool ok, bytes memory ret) = address(this).call(data);
        if (!ok) revert CallFailed(ret);
        emit Executed(id, data);
    }

    function cancel(bytes32 id) external {
        if (msg.sender != guardian && msg.sender != council) revert NotGuardian();
        if (queuedEta[id] == 0) revert NotQueued();
        delete queuedEta[id];
        emit Cancelled(id);
    }

    function setCouncil(address c) external onlySelf {
        if (c == address(0)) revert ZeroAddr();
        council = c;
        emit CouncilChanged(c);
    }

    function setGuardian(address g) external onlySelf {
        if (g == address(0)) revert ZeroAddr();
        guardian = g;
        emit GuardianChanged(g);
    }
}
