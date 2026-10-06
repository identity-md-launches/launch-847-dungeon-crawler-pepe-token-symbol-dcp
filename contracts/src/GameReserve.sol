// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Min} from "./interfaces/IERC20Min.sol";
import {TimelockedRoles} from "./TimelockedRoles.sol";
import {IPrizeRandomness} from "./interfaces/IPrizeRandomness.sol";

/// @title GameReserve
/// @notice Holds the DCP game reserve (70% of supply) and pays player prizes.
///
/// Flow per epoch (1 day):
///  1. After an epoch ends, requestDraw locks its eligibility snapshot hash and requests VRF.
///  2. The configured source authenticates the asynchronous coordinator fulfillment.
///  3. Anyone can finalizeDraw; no cancellation, replacement request or secret reveal is needed.
///     Legacy commit/anchor/reveal exists ONLY on local chain 31337 for fixture compatibility.
///     It is biased by withholding and MUST NOT be used for valuable prizes.
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
    IPrizeRandomness public randomnessSource;
    mapping(uint256 => bytes32) public eligibilityHash;
    mapping(uint256 => uint256) public postedInDay;
    mapping(uint256 => uint256) public postingDayCap;
    mapping(uint256 => bool) public drawRequestedInDay;

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
    error LocalFixtureOnly();
    event DrawRequested(uint256 indexed epoch, bytes32 snapshotHash);
    event DrawFinalized(uint256 indexed epoch, bytes32 randomness);
    event RandomnessSourceSet(address source);

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
        require(token_ != address(0) && challengeWindow_ >= 1 hours, "invalid reserve");
        require(epochAbsCap_ > 0 && epochAbsCap_ <= type(uint128).max, "invalid cap");
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

    /// One-time binding. A new provider requires a separately reviewed reserve migration.
    function setRandomnessSource(address source) external onlySelf {
        if (address(randomnessSource) != address(0) || source.code.length == 0) revert AlreadySet();
        randomnessSource = IPrizeRandomness(source);
        emit RandomnessSourceSet(source);
    }

    /// Snapshot contains eligibility, weights, rules version and budgets, frozen BEFORE VRF.
    /// Its publication/validity still requires an independent score reviewer and guardian.
    function requestDraw(uint256 epoch, bytes32 snapshotHash) external {
        if (msg.sender != poster) revert NotPoster();
        if (epoch == 0 || epoch >= currentEpoch() || epoch <= lastPostedEpoch) revert BadEpoch();
        if (address(randomnessSource) == address(0) || snapshotHash == bytes32(0)) revert NotReady();
        if (eligibilityHash[epoch] != bytes32(0) || rounds[epoch].seedHash != bytes32(0)) revert AlreadySet();
        if (drawRequestedInDay[currentEpoch()]) revert OverCap();
        drawRequestedInDay[currentEpoch()] = true;
        eligibilityHash[epoch] = snapshotHash;
        randomnessSource.request(epoch);
        emit DrawRequested(epoch, snapshotHash);
    }

    function finalizeDraw(uint256 epoch) external {
        if (eligibilityHash[epoch] == bytes32(0)) revert NotReady();
        if (rounds[epoch].randomness != bytes32(0)) revert AlreadySet();
        (bool fulfilled, bytes32 word) = randomnessSource.result(epoch);
        if (!fulfilled) revert NotReady();
        // Domain-separated hash also permits a legitimate all-zero VRF word.
        bytes32 randomness = keccak256(abi.encode(address(this), block.chainid, epoch, word));
        rounds[epoch].randomness = randomness;
        emit DrawFinalized(epoch, randomness);
    }

    function commitSeed(uint256 epoch, bytes32 seedHash) external {
        if (block.chainid != 31337 || address(randomnessSource) != address(0)) revert LocalFixtureOnly();
        if (msg.sender != poster) revert NotPoster();
        if (epoch <= currentEpoch()) revert BadEpoch(); // must be committed before epoch starts
        Round storage r = rounds[epoch];
        if (seedHash == bytes32(0)) revert BadSeed();
        if (r.seedHash != bytes32(0)) revert AlreadySet();
        r.seedHash = seedHash;
        emit SeedCommitted(epoch, seedHash);
    }

    /// @notice Permissionless: fixes the entropy block once the epoch has ended.
    function anchor(uint256 epoch) external {
        if (block.chainid != 31337 || address(randomnessSource) != address(0)) revert LocalFixtureOnly();
        Round storage r = rounds[epoch];
        if (epoch >= currentEpoch() || r.seedHash == bytes32(0)) revert NotReady();
        if (r.anchorBlock != 0) revert AlreadySet();
        r.anchorBlock = uint64(block.number);
        emit Anchored(epoch, block.number);
    }

    function revealSeed(uint256 epoch, bytes32 seed) external {
        if (block.chainid != 31337 || address(randomnessSource) != address(0)) revert LocalFixtureOnly();
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
        if (root == bytes32(0) || total == 0) revert NotReady();
        uint256 day = currentEpoch();
        if (postingDayCap[day] == 0) postingDayCap[day] = epochCap();
        // Backlogged epochs may not be used to burst many days' emissions in one day.
        if (total > epochCap() || postedInDay[day] + total > postingDayCap[day]) revert OverCap();
        postedInDay[day] += total;
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
