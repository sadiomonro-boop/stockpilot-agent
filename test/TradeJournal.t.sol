// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import "forge-std/Test.sol";
import "../contracts/TradeJournal.sol";

contract TradeJournalTest is Test {
    TradeJournal journal;
    address owner = address(0xA11CE);
    address stranger = address(0xBEEF);

    function setUp() public {
        vm.prank(owner);
        journal = new TradeJournal();
    }

    function testOwnerIsDeployer() public view {
        assertEq(journal.owner(), owner);
    }

    function testRecordTradeStoresAndEmits() public {
        bytes32 reason = keccak256("BUY TSLAc: target 9.50% vs current 0.00%");
        vm.prank(owner);
        vm.expectEmit(true, false, false, true, address(journal));
        emit TradeJournal.TradeRecorded(0, "TSLAc", true, 2_500_0000, 38_779_000_000, reason, block.timestamp);
        uint256 id = journal.recordTrade("TSLAc", true, 2_500_0000, 38_779_000_000, reason);
        assertEq(id, 0);
        assertEq(journal.tradeCount(), 1);

        TradeJournal.Trade memory t = journal.getTrade(0);
        assertEq(t.symbol, "TSLAc");
        assertTrue(t.isBuy);
        assertEq(t.amount, 2_500_0000);
        assertEq(t.price, 38_779_000_000);
        assertEq(t.reasonHash, reason);
        assertEq(t.timestamp, block.timestamp);
    }

    function testIdsAreSequential() public {
        vm.startPrank(owner);
        journal.recordTrade("NVDAc", true, 1_000_0000, 16_077_000_000, bytes32(uint256(1)));
        journal.recordTrade("NVDAc", false, 500_0000, 16_200_000_000, bytes32(uint256(2)));
        vm.stopPrank();
        assertEq(journal.tradeCount(), 2);
        assertEq(journal.getTrade(1).symbol, "NVDAc");
        assertFalse(journal.getTrade(1).isBuy);
    }

    function testOnlyOwnerCanRecord() public {
        vm.prank(stranger);
        vm.expectRevert("TradeJournal: not owner");
        journal.recordTrade("TSLAc", true, 1, 1, bytes32(0));
    }

    function testRejectsEmptySymbolZeroAmountZeroPrice() public {
        vm.startPrank(owner);
        vm.expectRevert("TradeJournal: empty symbol");
        journal.recordTrade("", true, 1, 1, bytes32(0));
        vm.expectRevert("TradeJournal: zero amount");
        journal.recordTrade("TSLAc", true, 0, 1, bytes32(0));
        vm.expectRevert("TradeJournal: zero price");
        journal.recordTrade("TSLAc", true, 1, 0, bytes32(0));
        vm.stopPrank();
    }

    function testGetUnknownTradeReverts() public {
        vm.expectRevert("TradeJournal: unknown id");
        journal.getTrade(0);
    }

    function testTransferOwnership() public {
        vm.prank(owner);
        journal.transferOwnership(stranger);
        assertEq(journal.owner(), stranger);
        vm.prank(stranger);
        journal.recordTrade("AAPLc", true, 1_000_0000, 35_559_000_000, bytes32(0));
        assertEq(journal.tradeCount(), 1);
    }

    function testTransferOwnershipRejectsZero() public {
        vm.prank(owner);
        vm.expectRevert("TradeJournal: zero owner");
        journal.transferOwnership(address(0));
    }
}
