// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20Min} from "../../src/interfaces/IERC20Min.sol";

/// Test-only ERC-20 (IMD and WETH stand-ins). LABELLED FIXTURE — not a production asset.
contract MockERC20 {
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory s) {
        symbol = s;
    }

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transfer(address to, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
        return true;
    }

    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= v;
        balanceOf[f] -= v;
        balanceOf[to] += v;
        return true;
    }

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }
}

/// Test-only model of the IMD launch factory as described in the brief: single-sided token seed
/// against virtual IMD depth, 1.25% swap fee split 1.00% requester / 0.25% IMD, one-time
/// setRequester by the launcher, permissionless claimFees + withdraw that always pay the
/// requester. LP is owned by the factory (locked). NOT verified against the real factory.
contract MockIMDFactory {
    uint256 public constant FEE_BPS = 125;
    uint256 public constant REQUESTER_BPS = 100;

    struct Launch {
        address launcher;
        address token;
        address requester;
        uint256 tokenReserve;
        uint256 imdReserve; // real IMD held
        uint256 virtualImd; // virtual depth for single-sided seed
        uint256 accruedToken;
        uint256 accruedImd;
        uint256 claimableToken;
        uint256 claimableImd;
    }

    IERC20Min public immutable imd;
    address public immutable imdProtocol;
    uint64 public nextId = 1;
    mapping(uint64 => Launch) public launches;

    constructor(address imd_, address imdProtocol_) {
        imd = IERC20Min(imd_);
        imdProtocol = imdProtocol_;
    }

    function launch(address token, uint256 seed, uint256 virtualImd) external returns (uint64 id) {
        id = nextId++;
        IERC20Min(token).transferFrom(msg.sender, address(this), seed);
        launches[id] = Launch(msg.sender, token, address(0), seed, 0, virtualImd, 0, 0, 0, 0);
    }

    function setRequester(uint64 id, address requester) external {
        Launch storage l = launches[id];
        require(msg.sender == l.launcher, "launcher");
        require(l.requester == address(0), "set");
        l.requester = requester;
    }

    /// buyDcp: IMD in, DCP out. sell: DCP in, IMD out.
    function swap(uint64 id, bool buyDcp, uint256 amountIn) external returns (uint256 out) {
        Launch storage l = launches[id];
        uint256 fee = (amountIn * FEE_BPS) / 10_000;
        uint256 toReq = (amountIn * REQUESTER_BPS) / 10_000;
        uint256 net = amountIn - fee;
        if (buyDcp) {
            imd.transferFrom(msg.sender, address(this), amountIn);
            l.accruedImd += toReq;
            imd.transfer(imdProtocol, fee - toReq);
            uint256 y = l.imdReserve + l.virtualImd;
            out = (l.tokenReserve * net) / (y + net);
            l.imdReserve += net;
            l.tokenReserve -= out;
            IERC20Min(l.token).transfer(msg.sender, out);
        } else {
            IERC20Min(l.token).transferFrom(msg.sender, address(this), amountIn);
            l.accruedToken += toReq;
            IERC20Min(l.token).transfer(imdProtocol, fee - toReq);
            uint256 y = l.imdReserve + l.virtualImd;
            out = (y * net) / (l.tokenReserve + net);
            require(out <= l.imdReserve, "depth");
            l.tokenReserve += net;
            l.imdReserve -= out;
            imd.transfer(msg.sender, out);
        }
    }

    function claimFees(uint64 id) external {
        Launch storage l = launches[id];
        l.claimableToken += l.accruedToken;
        l.claimableImd += l.accruedImd;
        l.accruedToken = 0;
        l.accruedImd = 0;
    }

    function withdraw(uint64 id) external {
        Launch storage l = launches[id];
        require(l.requester != address(0), "no requester");
        uint256 t = l.claimableToken;
        uint256 i = l.claimableImd;
        l.claimableToken = 0;
        l.claimableImd = 0;
        if (t > 0) IERC20Min(l.token).transfer(l.requester, t);
        if (i > 0) imd.transfer(l.requester, i);
    }
}

/// Test oracle with settable price (1e18 = 1:1). LABELLED FIXTURE.
contract MockOracle {
    mapping(address => uint256) public priceE18;

    function set(address token, uint256 p) external {
        priceE18[token] = p;
    }

    function quote(address tokenIn, address, uint256 amountIn) external view returns (uint256) {
        return (amountIn * priceE18[tokenIn]) / 1e18;
    }
}

/// Test swap adapter: pays `rateE18` IMD per tokenIn, minus `haircutBps` (to model a sandwich or
/// shallow pool). Reverts if output < minOut, like a real router.
contract MockSwapAdapter {
    MockERC20 public immutable imd;
    mapping(address => uint256) public rateE18;
    uint256 public haircutBps;
    bool public lie; // pretends success but sends less than minOut

    constructor(address imd_) {
        imd = MockERC20(imd_);
    }

    function set(address token, uint256 r, uint256 haircut, bool lie_) external {
        rateE18[token] = r;
        haircutBps = haircut;
        lie = lie_;
    }

    function swapExactIn(address tokenIn, address, uint256 amountIn, uint256 minOut, address to)
        external
        returns (uint256 out)
    {
        IERC20Min(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        out = (amountIn * rateE18[tokenIn]) / 1e18;
        out = (out * (10_000 - haircutBps)) / 10_000;
        if (!lie) require(out >= minOut, "slippage");
        imd.mint(to, out);
    }
}
