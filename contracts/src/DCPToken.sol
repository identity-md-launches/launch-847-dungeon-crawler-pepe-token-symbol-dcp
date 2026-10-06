// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Dungeon Crawler Pepe (DCP)
/// @notice Fixed-supply ERC-20. 1,000,000,000 DCP (18 decimals) minted exactly once in the
///         constructor. No owner, no mint, no pause, no upgrade, no transfer tax, no hooks.
///         Holders may burn their own tokens (used by the game shop sink); burning only ever
///         lowers totalSupply.
contract DCPToken {
    string public constant name = "Dungeon Crawler Pepe";
    string public constant symbol = "DCP";
    uint8 public constant decimals = 18;
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error LengthMismatch();
    error BadAllocation();
    error ZeroAddress();
    error InsufficientBalance();
    error InsufficientAllowance();

    /// @param recipients allocation recipients (e.g. pool seeder, swarm escrow, GameReserve)
    /// @param amounts    amounts; must sum to exactly TOTAL_SUPPLY
    constructor(address[] memory recipients, uint256[] memory amounts) {
        if (recipients.length != amounts.length || recipients.length == 0) revert LengthMismatch();
        uint256 sum;
        for (uint256 i; i < recipients.length; ++i) {
            if (recipients[i] == address(0)) revert ZeroAddress();
            balanceOf[recipients[i]] += amounts[i];
            sum += amounts[i];
            emit Transfer(address(0), recipients[i], amounts[i]);
        }
        if (sum != TOTAL_SUPPLY) revert BadAllocation();
        totalSupply = sum;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < value) revert InsufficientAllowance();
            unchecked {
                allowance[from][msg.sender] = allowed - value;
            }
        }
        _transfer(from, to, value);
        return true;
    }

    /// @notice Destroy `value` of the caller's own tokens.
    function burn(uint256 value) external {
        uint256 bal = balanceOf[msg.sender];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[msg.sender] = bal - value;
            totalSupply -= value;
        }
        emit Transfer(msg.sender, address(0), value);
    }

    function _transfer(address from, address to, uint256 value) private {
        if (to == address(0)) revert ZeroAddress();
        uint256 bal = balanceOf[from];
        if (bal < value) revert InsufficientBalance();
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }
}
