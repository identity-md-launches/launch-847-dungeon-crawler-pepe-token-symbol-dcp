// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Min} from "./interfaces/IERC20Min.sol";
import {ISwapAdapter, IPriceOracle, IIMDFactory} from "./interfaces/ISwapAdapter.sol";
import {TimelockedRoles} from "./TimelockedRoles.sol";

interface IWETH {
    function deposit() external payable;
}

/// @title OpsTreasury
/// @notice The launch's fee requester. Receives LP fees (DCP + IMD, or DCP + WETH/ETH) and turns
///         them into paid IMD work and operator gas, within hard caps.
///
/// State transitions and who pokes them:
///  - harvest():      anyone. Pulls fees out of the IMD factory (claimFees + withdraw). Fees are
///                    always paid to this contract, so a caller can only help.
///  - wrapEth():      anyone. Wraps raw ETH above the gas reserve to WETH.
///  - recycleDcp():   anyone. DCP above DCP_BUFFER goes back to the GameReserve (not sold).
///  - convert():      anyone, only while IMD runway is below the replenish threshold. Bounded by
///                    per-call and per-epoch caps, TWAP-anchored minimum output and a dust floor.
///                    Caller earns a capped IMD bounty that covers gas. A failed swap reverts, so
///                    funds are never lost to a failed conversion.
///  - topUpGas():     anyone. Sends ETH to an allowlisted operator address whose balance fell
///                    below GAS_LOW, capped per epoch.
///  - payWork():      paymentSigner only (an isolated hot key with no other power). Pays an
///                    allowlisted IMD work payee, unique invoice id, per-payment/per-epoch caps
///                    that halve under low runway and stop entirely at the essential floor.
///  - freeze():       guardian. Stops payWork/convert. Unfreeze needs the council timelock.
/// There is no function that sends any asset to an arbitrary address.
contract OpsTreasury is TimelockedRoles {
    uint256 public constant EPOCH = 1 days;

    IERC20Min public immutable dcp;
    IERC20Min public immutable imd;
    IERC20Min public immutable weth;
    address public immutable reserve;
    IIMDFactory public immutable factory;
    uint64 public immutable launchId;

    // Hard bounds fixed at deploy; timelocked setters can only move values inside them.
    uint256 public immutable MAX_PAY_PER_EPOCH;
    uint256 public immutable MAX_SLIPPAGE_BPS;
    uint256 public immutable MAX_BOUNTY;
    uint256 public immutable MAX_CONVERT_PER_EPOCH;
    uint256 public immutable MAX_GAS_PER_EPOCH;
    uint256 public immutable MIN_ESSENTIAL_FLOOR;
    uint256 public constant MAX_WETH_PER_CALL = 0.05 ether;
    uint256 public constant MAX_WETH_PER_EPOCH = 0.2 ether;
    uint256 private entered;

    modifier nonReentrant() {
        require(entered == 0, "reentrant");
        entered = 1;
        _;
        entered = 0;
    }

    ISwapAdapter public swapAdapter;
    IPriceOracle public oracle;
    address public paymentSigner;
    bool public frozen;

    uint256 public payPerEpoch; // IMD
    uint256 public payPerPayment; // IMD
    uint256 public essentialFloor; // IMD that payWork never dips below (keeps critical ops alive)
    uint256 public lowRunway; // below this, payPerEpoch is halved
    uint256 public replenishBelow; // convert() allowed only while IMD balance < this
    uint256 public convertPerCall; // max tokenIn per convert
    uint256 public convertPerEpoch; // max tokenIn per epoch, per asset
    uint256 public dustFloor; // min tokenIn per convert (batch dust)
    uint256 public slippageBps;
    uint256 public bounty; // IMD paid to convert() caller
    uint256 public dcpBuffer; // DCP kept for conversion; excess recycled to reserve
    uint256 public gasReserve; // ETH kept for operator gas
    uint256 public gasTopUp; // ETH per top-up
    uint256 public gasLow; // operator balance that triggers a top-up
    uint256 public gasPerEpoch; // ETH per epoch for top-ups

    mapping(address => bool) public payees;
    mapping(address => bool) public gasOperators;
    mapping(bytes32 => bool) public invoicePaid;
    mapping(uint256 => uint256) public paidInEpoch;
    mapping(uint256 => mapping(address => uint256)) public convertedInEpoch;
    mapping(uint256 => uint256) public gasInEpoch;

    struct Params {
        uint256 payPerEpoch;
        uint256 payPerPayment;
        uint256 essentialFloor;
        uint256 lowRunway;
        uint256 replenishBelow;
        uint256 convertPerCall;
        uint256 convertPerEpoch;
        uint256 dustFloor;
        uint256 slippageBps;
        uint256 bounty;
        uint256 dcpBuffer;
        uint256 gasReserve;
        uint256 gasTopUp;
        uint256 gasLow;
        uint256 gasPerEpoch;
    }

    event Harvested(uint256 dcpDelta, uint256 imdDelta, uint256 wethDelta);
    event Recycled(uint256 amount);
    event Converted(address indexed tokenIn, uint256 amountIn, uint256 imdOut, address caller, uint256 bountyPaid);
    event WorkPaid(bytes32 indexed invoiceId, address indexed payee, uint256 amount);
    event GasToppedUp(address indexed operator, uint256 amount);
    event Frozen(bool frozen);
    event ParamsSet(Params p);
    event PayeeSet(address payee, bool allowed);
    event GasOperatorSet(address op, bool allowed);
    event SignerSet(address signer);
    event RouteSet(address adapter, address oracle);

    error IsFrozen();
    error NotSigner();
    error NotPayee();
    error DuplicateInvoice();
    error OverCap();
    error BelowFloor();
    error NotNeeded();
    error BadAsset();
    error Dust();
    error MinOutTooLow();
    error ShortOutput();
    error OutOfBounds();
    error TransferFailed();

    constructor(
        address[6] memory addrs, // dcp, imd, weth, reserve, factory, council
        address guardian_,
        uint64 launchId_,
        uint256 delay_,
        uint256[3] memory bounds, // maxPayPerEpoch, maxSlippageBps, maxBounty
        Params memory p
    ) TimelockedRoles(addrs[5], guardian_, delay_) {
        require(
            addrs[0] != address(0) && addrs[1] != address(0) && addrs[2] != address(0) && addrs[3] != address(0)
                && addrs[4] != address(0),
            "zero address"
        );
        require(addrs[0] != addrs[1] && addrs[0] != addrs[2] && addrs[1] != addrs[2], "same asset");
        require(bounds[1] <= 1_000, "slippage bound");
        dcp = IERC20Min(addrs[0]);
        imd = IERC20Min(addrs[1]);
        weth = IERC20Min(addrs[2]);
        reserve = addrs[3];
        factory = IIMDFactory(addrs[4]);
        launchId = launchId_;
        MAX_PAY_PER_EPOCH = bounds[0];
        MAX_SLIPPAGE_BPS = bounds[1];
        MAX_BOUNTY = bounds[2];
        MAX_CONVERT_PER_EPOCH = p.convertPerEpoch;
        MAX_GAS_PER_EPOCH = p.gasPerEpoch;
        MIN_ESSENTIAL_FLOOR = p.essentialFloor;
        _setParams(p);
    }

    receive() external payable {}

    function epoch() public view returns (uint256) {
        return block.timestamp / EPOCH;
    }

    // ------------------------------------------------------------------ permissionless

    function harvest() external nonReentrant {
        uint256 d0 = dcp.balanceOf(address(this));
        uint256 i0 = imd.balanceOf(address(this));
        uint256 w0 = weth.balanceOf(address(this)) + address(this).balance;
        factory.claimFees(launchId);
        factory.withdraw(launchId);
        emit Harvested(
            dcp.balanceOf(address(this)) - d0,
            imd.balanceOf(address(this)) - i0,
            weth.balanceOf(address(this)) + address(this).balance - w0
        );
    }

    function wrapEth() external nonReentrant {
        uint256 bal = address(this).balance;
        if (bal <= gasReserve) revert NotNeeded();
        IWETH(address(weth)).deposit{value: bal - gasReserve}();
    }

    function recycleDcp() external nonReentrant {
        uint256 bal = dcp.balanceOf(address(this));
        if (bal <= dcpBuffer) revert NotNeeded();
        uint256 amt = bal - dcpBuffer;
        if (!dcp.transfer(reserve, amt)) revert TransferFailed();
        emit Recycled(amt);
    }

    function convert(address tokenIn, uint256 amountIn, uint256 minOut) external nonReentrant returns (uint256 out) {
        if (frozen) revert IsFrozen();
        if (tokenIn != address(dcp) && tokenIn != address(weth)) revert BadAsset();
        if (imd.balanceOf(address(this)) >= replenishBelow) revert NotNeeded();
        uint256 floor = tokenIn == address(weth) ? 0.001 ether : dustFloor;
        if (amountIn == 0 || amountIn < floor) revert Dust();
        if (amountIn > convertPerCall) revert OverCap();
        uint256 e = epoch();
        if (
            tokenIn == address(weth)
                && (amountIn > MAX_WETH_PER_CALL || convertedInEpoch[e][tokenIn] + amountIn > MAX_WETH_PER_EPOCH)
        ) revert OverCap();
        if (convertedInEpoch[e][tokenIn] + amountIn > convertPerEpoch) revert OverCap();
        uint256 fair = oracle.quote(tokenIn, address(imd), amountIn);
        if (fair == 0 || minOut == 0 || minOut < (fair * (10_000 - slippageBps)) / 10_000) revert MinOutTooLow();
        convertedInEpoch[e][tokenIn] += amountIn;

        uint256 before = imd.balanceOf(address(this));
        if (!IERC20Min(tokenIn).approve(address(swapAdapter), amountIn)) revert TransferFailed();
        swapAdapter.swapExactIn(tokenIn, address(imd), amountIn, minOut, address(this));
        if (!IERC20Min(tokenIn).approve(address(swapAdapter), 0)) revert TransferFailed();
        out = imd.balanceOf(address(this)) - before;
        if (out < minOut) revert ShortOutput();

        uint256 b = bounty < out / 10 ? bounty : out / 10;
        if (b > 0 && !imd.transfer(msg.sender, b)) revert TransferFailed();
        emit Converted(tokenIn, amountIn, out, msg.sender, b);
    }

    function topUpGas(address op) external nonReentrant {
        if (!gasOperators[op]) revert NotPayee();
        if (op.balance >= gasLow) revert NotNeeded();
        uint256 e = epoch();
        if (gasInEpoch[e] + gasTopUp > gasPerEpoch) revert OverCap();
        if (address(this).balance < gasTopUp) revert BelowFloor();
        gasInEpoch[e] += gasTopUp;
        (bool ok,) = op.call{value: gasTopUp}("");
        if (!ok) revert TransferFailed();
        emit GasToppedUp(op, gasTopUp);
    }

    // ------------------------------------------------------------------ payment signer

    function payWork(address payee, uint256 amount, bytes32 invoiceId) external nonReentrant {
        if (msg.sender != paymentSigner) revert NotSigner();
        if (amount == 0 || invoiceId == bytes32(0)) revert OutOfBounds();
        if (frozen) revert IsFrozen();
        if (!payees[payee]) revert NotPayee();
        if (invoicePaid[invoiceId]) revert DuplicateInvoice();
        if (amount > payPerPayment) revert OverCap();
        uint256 bal = imd.balanceOf(address(this));
        if (bal < essentialFloor + amount) revert BelowFloor();
        uint256 cap = bal < lowRunway ? payPerEpoch / 2 : payPerEpoch;
        uint256 e = epoch();
        if (paidInEpoch[e] + amount > cap) revert OverCap();
        invoicePaid[invoiceId] = true;
        paidInEpoch[e] += amount;
        if (!imd.transfer(payee, amount)) revert TransferFailed();
        emit WorkPaid(invoiceId, payee, amount);
    }

    // ------------------------------------------------------------------ guardian

    function freeze() external {
        if (msg.sender != guardian) revert NotGuardian();
        frozen = true;
        emit Frozen(true);
    }

    // ------------------------------------------------------------------ timelocked (self-calls)

    function unfreeze() external onlySelf {
        frozen = false;
        emit Frozen(false);
    }

    function setParams(Params calldata p) external onlySelf {
        _setParams(p);
    }

    function setPayee(address payee, bool allowed) external onlySelf {
        payees[payee] = allowed;
        emit PayeeSet(payee, allowed);
    }

    function setGasOperator(address op, bool allowed) external onlySelf {
        gasOperators[op] = allowed;
        emit GasOperatorSet(op, allowed);
    }

    function setPaymentSigner(address s) external onlySelf {
        paymentSigner = s;
        emit SignerSet(s);
    }

    function setRoute(address adapter, address oracle_) external onlySelf {
        swapAdapter = ISwapAdapter(adapter);
        oracle = IPriceOracle(oracle_);
        emit RouteSet(adapter, oracle_);
    }

    function _setParams(Params memory p) private {
        if (
            p.convertPerEpoch > MAX_CONVERT_PER_EPOCH || p.convertPerCall > p.convertPerEpoch
                || p.gasPerEpoch > MAX_GAS_PER_EPOCH || p.essentialFloor < MIN_ESSENTIAL_FLOOR
                || p.lowRunway < p.essentialFloor || p.replenishBelow < p.lowRunway
        ) revert OutOfBounds();
        if (p.payPerEpoch > MAX_PAY_PER_EPOCH) revert OutOfBounds();
        if (p.payPerPayment > p.payPerEpoch) revert OutOfBounds();
        if (p.slippageBps > MAX_SLIPPAGE_BPS) revert OutOfBounds();
        if (p.bounty > MAX_BOUNTY) revert OutOfBounds();
        if (p.gasTopUp > p.gasPerEpoch) revert OutOfBounds();
        payPerEpoch = p.payPerEpoch;
        payPerPayment = p.payPerPayment;
        essentialFloor = p.essentialFloor;
        lowRunway = p.lowRunway;
        replenishBelow = p.replenishBelow;
        convertPerCall = p.convertPerCall;
        convertPerEpoch = p.convertPerEpoch;
        dustFloor = p.dustFloor;
        slippageBps = p.slippageBps;
        bounty = p.bounty;
        dcpBuffer = p.dcpBuffer;
        gasReserve = p.gasReserve;
        gasTopUp = p.gasTopUp;
        gasLow = p.gasLow;
        gasPerEpoch = p.gasPerEpoch;
        emit ParamsSet(p);
    }
}
