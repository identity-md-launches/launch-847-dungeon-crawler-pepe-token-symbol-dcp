// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Min} from "./interfaces/IERC20Min.sol";
import {TimelockedRoles} from "./TimelockedRoles.sol";

/// @title GameReserve
/// @notice Holds the DCP game reserve (70% of supply) and pays player prizes.
///
/// Flow per epoch (1 day):
///  1. Before the epoch starts the poster commits keccak256(seed) (commitSeed).
///  2. After the epoch ends anyone calls anchor(); the next block's hash becomes public entropy.
///  3. Poster reveals seed within 256 blocks; randomness = keccak256(seed, blockhash(anchor+1)).
///     Neither the server (doesn't know the blockhash) nor a block proposer (doesn't know seed)
///     controls it. The off-chain prize draw is recomputable from published data + randomness.
///  4. Poster posts a Merkle root of (index, account, amount) with its total. The total is capped
///     on-chain by min(EPOCH_ABS_CAP, freeBalance * EPOCH_BPS / 10000) — a geometric emission
///     that can never empty the reserve. The total is reserved as a liability immediately.
///  5. During CHALLENGE_WINDOW the guardian may veto the root (liability released).
///  6. After the window anyone may submit claims; each leaf pays once, to its account, forever.
///
/// There is no withdraw function. A compromised poster can at most mis-assign one epoch's capped
/// emission, and only if the guardian fails to veto within the window. Already-final roots stay
/// claimable even if the poster, council and guardian all disappear (safe dormancy).
contract GameReserve is TimelockedRoles {
    IERC20Min public immutable token;
    uint256 public immutable GENESIS;
    uint256 public constant EPOCH = 1 days;
    uint256 public immutable CHALLENGE_WINDOW;
    uint256 public immutable EPOCH_BPS; // max share of free balance per epoch
    uint256 public immutable EPOCH_ABS_CAP; // absolute DCP cap per epoch

    address public poster;
    uint256 public outstanding; // posted, not-vetoed, not-yet-claimed liabilities
    uint256 public lastPostedEpoch;

    struct Round {
        bytes32 seedHash;
        uint64 anchorBlock;
        bytes32 randomness;
        bytes32 root;
        uint128 total;
        uint128 claimed;
        uint64 postedAt;
        bool vetoed;
    }

    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(uint256 => uint256)) private claimedBits;

    event PosterChanged(address poster);
    event SeedCommitted(uint256 indexed epoch, bytes32 seedHash);
    event Anchored(uint256 indexed epoch, uint256 blockNumber);
    event SeedRevealed(uint256 indexed epoch, bytes32 seed, bytes32 randomness);
    event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total);
    event RootVetoed(uint256 indexed epoch);
    event Claimed(uint256 indexed epoch, uint256 indexed index, address indexed account, uint256 amount);

    error NotPoster();
    error BadEpoch();
    error AlreadySet();
    error NotReady();
    error BadSeed();
    error RevealExpired();
    error OverCap();
    error InWindow();
    error Vetoed();
    error AlreadyClaimed();
    error BadProof();
    error TransferFailed();

    constructor(
        address token_,
        address council_,
        address guardian_,
        address poster_,
        uint256 delay_,
        uint256 challengeWindow_,
        uint256 epochBps_,
        uint256 epochAbsCap_
    ) TimelockedRoles(council_, guardian_, delay_) {
        require(epochBps_ <= 100, "bps>1%"); // hard ceiling: never more than 1%/day
        token = IERC20Min(token_);
        poster = poster_;
        GENESIS = block.timestamp;
        CHALLENGE_WINDOW = challengeWindow_;
        EPOCH_BPS = epochBps_;
        EPOCH_ABS_CAP = epochAbsCap_;
    }

    // ------------------------------------------------------------------ views

    function currentEpoch() public view returns (uint256) {
        return (block.timestamp - GENESIS) / EPOCH + 1;
    }

    function freeBalance() public view returns (uint256) {
        uint256 bal = token.balanceOf(address(this));
        return bal > outstanding ? bal - outstanding : 0;
    }

    function epochCap() public view returns (uint256) {
        uint256 c = (freeBalance() * EPOCH_BPS) / 10_000;
        return c < EPOCH_ABS_CAP ? c : EPOCH_ABS_CAP;
    }

    function isClaimed(uint256 epoch, uint256 index) public view returns (bool) {
        return claimedBits[epoch][index >> 8] & (1 << (index & 0xff)) != 0;
    }

    // ------------------------------------------------------------------ poster

    function commitSeed(uint256 epoch, bytes32 seedHash) external {
        if (msg.sender != poster) revert NotPoster();
        if (epoch <= currentEpoch()) revert BadEpoch(); // must be committed before epoch starts
        Round storage r = rounds[epoch];
        if (r.seedHash != bytes32(0)) revert AlreadySet();
        r.seedHash = seedHash;
        emit SeedCommitted(epoch, seedHash);
    }

    /// @notice Permissionless: fixes the entropy block once the epoch has ended.
    function anchor(uint256 epoch) external {
        Round storage r = rounds[epoch];
        if (epoch >= currentEpoch() || r.seedHash == bytes32(0)) revert NotReady();
        if (r.anchorBlock != 0) revert AlreadySet();
        r.anchorBlock = uint64(block.number);
        emit Anchored(epoch, block.number);
    }

    function revealSeed(uint256 epoch, bytes32 seed) external {
        if (msg.sender != poster) revert NotPoster();
        Round storage r = rounds[epoch];
        if (r.anchorBlock == 0 || block.number <= r.anchorBlock + 1) revert NotReady();
        if (r.randomness != bytes32(0)) revert AlreadySet();
        if (keccak256(abi.encodePacked(seed)) != r.seedHash) revert BadSeed();
        bytes32 bh = blockhash(r.anchorBlock + 1);
        if (bh == bytes32(0)) revert RevealExpired();
        r.randomness = keccak256(abi.encodePacked(seed, bh));
        emit SeedRevealed(epoch, seed, r.randomness);
    }

    function postRoot(uint256 epoch, bytes32 root, uint256 total) external {
        if (msg.sender != poster) revert NotPoster();
        if (epoch >= currentEpoch() || epoch <= lastPostedEpoch) revert BadEpoch();
        Round storage r = rounds[epoch];
        if (r.randomness == bytes32(0)) revert NotReady();
        if (total > epochCap()) revert OverCap();
        r.root = root;
        r.total = uint128(total);
        r.postedAt = uint64(block.timestamp);
        outstanding += total;
        lastPostedEpoch = epoch;
        emit RootPosted(epoch, root, total);
    }

    // ------------------------------------------------------------------ guardian

    function veto(uint256 epoch) external {
        if (msg.sender != guardian) revert NotGuardian();
        Round storage r = rounds[epoch];
        if (r.root == bytes32(0) || r.vetoed) revert NotReady();
        if (block.timestamp >= r.postedAt + CHALLENGE_WINDOW) revert InWindow();
        r.vetoed = true;
        outstanding -= r.total;
        emit RootVetoed(epoch);
    }

    // ------------------------------------------------------------------ claims

    struct ClaimArgs {
        uint256 epoch;
        uint256 index;
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    /// @notice Batch several epochs' small prizes into one transaction so gas doesn't eat them.
    function claimMany(ClaimArgs[] calldata c) external {
        for (uint256 i; i < c.length; ++i) {
            claim(c[i].epoch, c[i].index, c[i].account, c[i].amount, c[i].proof);
        }
    }

    /// @notice Permissionless; tokens always go to `account` from the leaf.
    function claim(uint256 epoch, uint256 index, address account, uint256 amount, bytes32[] calldata proof) public {
        Round storage r = rounds[epoch];
        if (r.root == bytes32(0)) revert NotReady();
        if (r.vetoed) revert Vetoed();
        if (block.timestamp < r.postedAt + CHALLENGE_WINDOW) revert InWindow();
        if (isClaimed(epoch, index)) revert AlreadyClaimed();
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(index, account, amount))));
        if (!_verify(proof, r.root, leaf)) revert BadProof();
        if (uint256(r.claimed) + amount > r.total) revert OverCap();
        claimedBits[epoch][index >> 8] |= 1 << (index & 0xff);
        r.claimed += uint128(amount);
        outstanding -= amount;
        if (!token.transfer(account, amount)) revert TransferFailed();
        emit Claimed(epoch, index, account, amount);
    }

    // ------------------------------------------------------------------ timelocked config

    function setPoster(address p) external onlySelf {
        poster = p; // address(0) = dormant: no new roots, existing claims unaffected
        emit PosterChanged(p);
    }

    function _verify(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        bytes32 h = leaf;
        for (uint256 i; i < proof.length; ++i) {
            bytes32 p = proof[i];
            h = h < p ? keccak256(abi.encodePacked(h, p)) : keccak256(abi.encodePacked(p, h));
        }
        return h == root;
    }
}
