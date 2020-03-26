/*

    Copyright 2020 dYdX Trading Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.

*/

import BigNumber from 'bignumber.js';
import {
  HttpProvider,
  IpcProvider,
  WebsocketProvider,
  Log,
  EventLog,
} from 'web3-core';
import {
  TransactionReceipt,
} from 'web3-eth';

// ============ Types ============

export type address = string;
export type TypedSignature = string;
export type Provider = HttpProvider | IpcProvider | WebsocketProvider;
export type BigNumberable = BigNumber | number | string;

// ============ Enums ============

export enum ConfirmationType {
  Hash = 0,
  Confirmed = 1,
  Both = 2,
  Simulate = 3,
}

export enum SigningMethod {
  Compatibility = 'Compatibility',   // picks intelligently between UnsafeHash and Hash
  UnsafeHash = 'UnsafeHash',         // raw hash signed
  Hash = 'Hash',                     // hash prepended according to EIP-191
  TypedData = 'TypedData',           // order hashed according to EIP-712
  MetaMask = 'MetaMask',             // order hashed according to EIP-712 (MetaMask-only)
  MetaMaskLatest = 'MetaMaskLatest', // ... according to latest version of EIP-712 (MetaMask-only)
  CoinbaseWallet = 'CoinbaseWallet', // ... according to latest version of EIP-712 (CoinbaseWallet)
}

export enum OrderStatus {
  Null = 0,
  Approved = 1,
  Canceled = 2,
}

export interface OrderState {
  status: OrderStatus;
  filledAmount: BigNumber;
}

// ============ Constants ============

export const Networks = {
  MAINNET: 1,
  KOVAN: 42,
};

// ============ Interfaces ============

export interface EthereumAccount {
  address?: string;
  privateKey: string;
}

export interface TxResult {
  transactionHash?: string;
  transactionIndex?: number;
  blockHash?: string;
  blockNumber?: number;
  from?: string;
  to?: string;
  contractAddress?: string;
  cumulativeGasUsed?: number;
  gasUsed?: number;
  logs?: Log[];
  events?: {
    [eventName: string]: EventLog;
  };
  status?: boolean;
  confirmation?: Promise<TransactionReceipt>;
  gasEstimate?: number;
  gas?: number;
}

export interface TxOptions {
  from?: address;
  gasPrice?: number;
  gas?: number;
  value?: number;
}

export interface SendOptions extends TxOptions {
  confirmations?: number;
  confirmationType?: ConfirmationType;
  gasMultiplier?: number;
}

export interface CallOptions extends TxOptions {
  blockNumber?: number;
}

// ============ Solidity Interfaces ============

export interface SignedIntStruct {
  value: string;
  isPositive: boolean;
}

export interface BalanceStruct {
  marginIsPositive: boolean;
  positionIsPositive: boolean;
  margin: string;
  position: string;
}

export interface FundingRateStruct {
  timestamp: BigNumber;
  isPositive: boolean;
  value: BigNumber;
}

export interface TradeArg {
  makerIndex: number;
  takerIndex: number;
  trader: address;
  data: string;
}

export interface TradeResult {
  marginAmount: BigNumber;
  positionAmount: BigNumber;
  isBuy: boolean;
  traderFlags: BigNumber;
}

export interface FundingRateBounds {
  maxAbsValue: FundingRate;
  maxAbsDiffPerUpdate: FundingRate;
  maxAbsDiffPerSecond: FundingRate;
}

export interface LoggedFundingRate {
  timestamp: BigNumber;
  baseValue: BaseValue;
}

export interface Index {
  timestamp: BigNumber;
  baseValue: BaseValue;
}

export interface Order {
  isBuy: boolean;
  isDecreaseOnly: boolean;
  amount: BigNumber;
  limitPrice: Price;
  triggerPrice: Price;
  limitFee: Fee;
  maker: address;
  taker: address;
  expiration: BigNumber;
  salt: BigNumber;
}

export interface SignedOrder extends Order {
  typedSignature: string;
}

// ============ Helper Functions ============

export function bnToSoliditySignedInt(value: BigNumberable): SignedIntStruct {
  const bn = new BigNumber(value);
  return {
    value: bn.abs().toFixed(0),
    isPositive: bn.isPositive(),
  };
}

export function bnFromSoliditySignedInt(struct: SignedIntStruct): BigNumber {
  if (struct.isPositive) {
    return new BigNumber(struct.value);
  }
  return new BigNumber(struct.value).negated();
}

// ============ Classes ============

export class Balance {
  public margin: BigNumber;
  public position: BigNumber;

  constructor(margin: BigNumberable, position: BigNumberable) {
    this.margin = new BigNumber(margin);
    this.position = new BigNumber(position);
  }

  public toSolidity(): BalanceStruct {
    return {
      marginIsPositive: this.margin.isPositive(),
      positionIsPositive: this.position.isPositive(),
      margin: this.margin.abs().toFixed(0),
      position: this.position.abs().toFixed(0),
    };
  }

  static fromSolidity(struct: BalanceStruct): Balance {
    const marginBN = new BigNumber(struct.margin);
    const positionBN = new BigNumber(struct.position);
    return new Balance(
      struct.marginIsPositive ? marginBN : marginBN.negated(),
      struct.positionIsPositive ? positionBN : positionBN.negated(),
    );
  }
}

// From BaseMath.sol.
export const BASE_DECIMALS = 18;

/**
 * A value that is represented on the smart contract by an integer shifted by `BASE` decimal places.
 */
export class BaseValue {
  readonly value: BigNumber;

  constructor(value: BigNumberable) {
    this.value = new BigNumber(value);
  }

  public toSolidity(): string {
    return this.value.abs().shiftedBy(BASE_DECIMALS).toFixed(0);
  }

  public toSoliditySignedInt(): SignedIntStruct {
    return {
      value: this.toSolidity(),
      isPositive: this.isPositive(),
    };
  }

  static fromSolidity(solidityValue: BigNumberable, isPositive: boolean = true): BaseValue {
    // Help to detect errors in the parsing and typing of Solidity data.
    if (typeof isPositive !== 'boolean') {
      throw new Error('Error in BaseValue.fromSolidity: isPositive was not a boolean');
    }

    let value = new BigNumber(solidityValue).shiftedBy(-BASE_DECIMALS);
    if (!isPositive) {
      value = value.negated();
    }
    return new BaseValue(value);
  }

  public times(value: BigNumberable): BaseValue {
    return new BaseValue(this.value.times(value));
  }

  public div(value: BigNumberable): BaseValue {
    return new BaseValue(this.value.div(value));
  }

  public plus(value: BigNumberable): BaseValue {
    return new BaseValue(this.value.plus(value));
  }

  public minus(value: BigNumberable): BaseValue {
    return new BaseValue(this.value.minus(value));
  }

  public negated(): BaseValue {
    return new BaseValue(this.value.negated());
  }

  public isPositive(): boolean {
    return this.value.isPositive();
  }

  public isNegative(): boolean {
    return this.value.isNegative();
  }
}

export class Price extends BaseValue {
}

export class Fee extends BaseValue {
  static fromBips(value: BigNumberable): Fee {
    return new Fee(new BigNumber('1e-4').times(value));
  }
}

export class FundingRate extends BaseValue {
  /**
   * Returns funding rate represented as an annual rate (assumes 365 days/year) given a daily rate.
   *
   * Note: Funding interest does not compound, as the interest affects margin balances but
   * is calculated based on position balances.
   */
  static fromDailyRate(rate: BigNumberable): FundingRate {
    return new FundingRate(new BigNumber(rate).times(365));
  }
}
