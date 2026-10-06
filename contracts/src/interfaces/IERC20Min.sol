// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 value) external returns (bool);
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function approve(address spender, uint256 value) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface IBurnable {
    function burn(uint256 value) external;
}
