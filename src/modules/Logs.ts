import _ from 'lodash';
import BigNumber from 'bignumber.js';
import Web3 from 'web3';
import { Log, EventLog } from 'web3-core';
import { Contract } from 'web3-eth-contract';
import { AbiInput, AbiItem } from 'web3-utils';

import { Contracts } from '../modules/Contracts';
import {
  Balance,
  BaseValue,
  Fee,
  Index,
  LoggedFundingRate,
  Price,
  TxResult,
} from '../lib/types';
import { ORDER_FLAGS } from '../lib/Constants';
import { addressesAreEqual } from '../lib/BytesHelper';

type IContractsByAddress = { [address: string]: Contract };

const TUPLE_MAP = {
  'struct P1Orders.Fill': ['amount', 'price', 'fee', 'isNegativeFee'],
};

export class Logs {
  private contracts: Contracts;
  private _contractsByAddress?: IContractsByAddress;
  private web3: Web3;

  constructor(
    contracts: Contracts,
    web3: Web3,
  ) {
    this.contracts = contracts;
    this.web3 = web3;
  }

  private get contractsByAddress(): IContractsByAddress {
    if (!this._contractsByAddress) {
      this._contractsByAddress = {};
      for (const { contract, isTest } of this.contracts.contractsList) {
        if (isTest) {
          continue; // ignore test contracts
        }
        if (!contract.options.address) {
          throw new Error('Contract has not been deployed');
        }
        this._contractsByAddress[contract.options.address.toLowerCase()] = contract;
      }
    }
    return this._contractsByAddress;
  }

  public parseLogs(receipt: TxResult): any {
    let events: any[];

    if (receipt.logs) {
      events = JSON.parse(JSON.stringify(receipt.logs));
      return events.map(e => this.parseLog(e)).filter(l => !!l);
    }

    if (receipt.events) {
      const tempEvents = JSON.parse(JSON.stringify(receipt.events));
      events = [];
      Object.values(tempEvents).forEach((e: any) => {
        if (Array.isArray(e)) {
          e.forEach(ev => events.push(ev));
        } else {
          events.push(e);
        }
      });
      events.sort((a, b) => a.logIndex - b.logIndex);
      return events.map(e => this.parseEvent(e)).filter(l => !!l);
    }

    throw new Error('Receipt has no logs');
  }

  private parseEvent(event: EventLog): any {
    return this.parseLog({
      address: event.address,
      data: event.raw.data,
      topics: event.raw.topics,
      logIndex: event.logIndex,
      transactionHash: event.transactionHash,
      transactionIndex: event.transactionIndex,
      blockHash: event.blockHash,
      blockNumber: event.blockNumber,
    });
  }

  private parseLog(log: Log): any {
    const logAddress = log.address.toLowerCase();

    // Check if the logs are coming from the proxy ABI.
    if (addressesAreEqual(logAddress, this.contracts.perpetualProxy.options.address)) {
      const parsedLog = this.parseLogWithContract(this.contracts.perpetualProxy, log);
      if (parsedLog) {
        return parsedLog;
      }
    }

    if (logAddress in this.contractsByAddress) {
      return this.parseLogWithContract(this.contractsByAddress[logAddress], log);
    }

    return null;
  }

  private parseLogWithContract(contract: Contract, log: Log): any {
    const events = contract.options.jsonInterface.filter(
      (e: AbiItem) => e.type === 'event',
    );

    const eventJson = events.find(
      (e: any) => e.signature.toLowerCase() === log.topics[0].toLowerCase(),
    );

    if (!eventJson) {
      return null;
    }

    const eventArgs = this.web3.eth.abi.decodeLog(
      eventJson.inputs,
      log.data,
      log.topics.slice(1),
    );

    return {
      ...log,
      name: eventJson.name,
      args: this.parseArgs(eventJson.inputs, eventArgs),
    };
  }

  private parseArgs(inputs: AbiInput[], eventArgs: any): any {
    const parsedObject: any = {};
    for (const input of inputs) {
      const { name } = input;
      parsedObject[name] = this.parseValue(input, eventArgs[name]);
    }
    return parsedObject;
  }

  private parseValue(input: AbiInput, argValue: any): any {
    if (input.type === 'bytes32') {
      switch (input.name) {
        case 'balance':
        case 'makerBalance':
        case 'takerBalance':
          return this.parseBalance(argValue);
        case 'index':
          return this.parseIndex(argValue);
        case 'flags':
          return this.parseOrderFlags(argValue);
        case 'fundingRate':
          return this.parseFundingRate(argValue);
      }
    }

    if (input.type === 'uint256') {
      switch (input.name) {
        case 'fee':
          return Fee.fromSolidity(argValue);
        case 'price':
        case 'oraclePrice':
        case 'settlementPrice':
        case 'triggerPrice':
          return Price.fromSolidity(argValue);
      }
    }

    if (input.type === 'address') {
      return argValue;
    }
    if (input.type === 'bool') {
      return argValue;
    }
    if (input.type.match(/^bytes[0-9]*$/)) {
      return argValue;
    }
    if (input.type.match(/^uint[0-9]*$/)) {
      return new BigNumber(argValue);
    }
    if (input.type === 'tuple') {
      return this.parseTuple(input, argValue);
    }
    throw new Error(`Unknown event arg type ${input.type}`);
  }

  private parseTuple(input: any, argValue: any): any {
    const { internalType } = input;

    if (!(internalType in TUPLE_MAP)) {
      throw new Error(`Unknown tuple type '${internalType}' in event`);
    }

    const expectedTupleArgs = TUPLE_MAP[internalType];
    const actualTupleArgs = _.map(input.components, 'name');

    if (!_.isEqual(expectedTupleArgs, actualTupleArgs)) {
      throw new Error(`Arg name mismatch for tuple ${internalType}`);
    }

    return this.parseArgs(input.components, argValue);
  }

  private parseBalance(balance: string): Balance {
    const margin = new BigNumber(balance.substr(4, 30), 16);
    const position = new BigNumber(balance.substr(36, 30), 16);
    const marginIsPositive = !new BigNumber(balance.substr(2, 2), 16).isZero();
    const positionIsPositive = !new BigNumber(balance.substr(34, 2), 16).isZero();
    const result = new Balance(
      marginIsPositive ? margin : margin.negated(),
      positionIsPositive ? position : position.negated(),
    );
    (result as any).rawValue = balance;
    return result;
  }

  private parseFundingRate(fundingRate: string): LoggedFundingRate {
    return this.parseIndex(fundingRate) as LoggedFundingRate;
  }

  private parseIndex(index: string): Index {
    const timestamp = new BigNumber(index.substr(2, 30), 16);
    const isPositive = !new BigNumber(index.substr(32, 2), 16).isZero();
    const value = new BigNumber(index.substr(34, 32), 16);
    return {
      timestamp,
      rawValue: index,
      baseValue: BaseValue.fromSolidity(value, isPositive),
    } as Index;
  }

  private parseOrderFlags(flags: string): any {
    const flagsNumber = new BigNumber(flags, 16).mod(8).toNumber();
    return {
      rawValue: flags,
      isBuy: (flagsNumber & ORDER_FLAGS.IS_BUY) !== 0,
      isDecreaseOnly: (flagsNumber & ORDER_FLAGS.IS_DECREASE_ONLY) !== 0,
      isNegativeLimitFee: (flagsNumber & ORDER_FLAGS.IS_NEGATIVE_LIMIT_FEE) !== 0,
    };
  }
}
