import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";

import { StateMap, assert } from "@proto-kit/protocol";

import { Field, Provable, PublicKey, Struct, UInt64 } from "snarkyjs";
import { inject } from "tsyringe";
import { Admin } from "./Admin";

export const errors = {
  senderNotFrom: () => "Sender does not match 'from'",
  fromBalanceInsufficient: () => "From balance is insufficient",
  burnBalanceInsufficient: () => "Burn balance is insufficient",
};

export class TokenId extends Field {}
export class BalancesKey extends Struct({
  tokenId: TokenId,
  address: PublicKey,
}) {
  public static from(value: { tokenId: TokenId; address: PublicKey }) {
    return new BalancesKey(value);
  }
}

export class Balance extends UInt64 {}

@runtimeModule()
export class Balances extends RuntimeModule<unknown> {
  @state() public balances = StateMap.from<BalancesKey, Balance>(
    BalancesKey,
    Balance
  );

  public constructor(@inject("Admin") public admin: Admin) {
    super();
  }

  public getBalance(tokenId: TokenId, address: PublicKey): Balance {
    const key = new BalancesKey({ tokenId, address });
    const balanceOption = this.balances.get(key);

    return Provable.if(
      balanceOption.isSome,
      Balance,
      balanceOption.value,
      Balance.from(0)
    );
  }

  public setBalance(tokenId: TokenId, address: PublicKey, amount: Balance) {
    const key = new BalancesKey({ tokenId, address });
    this.balances.set(key, amount);
  }

  public transfer(
    tokenId: TokenId,
    from: PublicKey,
    to: PublicKey,
    amount: Balance
  ) {
    const fromBalance = this.getBalance(tokenId, from);
    const toBalance = this.getBalance(tokenId, to);

    const fromBalanceIsSufficient = fromBalance.greaterThanOrEqual(amount);

    assert(fromBalanceIsSufficient, errors.fromBalanceInsufficient());

    // used to prevent field underflow during subtraction
    const paddedFrombalance = fromBalance.add(amount);
    const safeFromBalance = Provable.if(
      fromBalanceIsSufficient,
      Balance,
      fromBalance,
      paddedFrombalance
    );

    const newFromBalance = safeFromBalance.sub(amount);
    const newToBalance = toBalance.add(amount);

    this.setBalance(tokenId, from, newFromBalance);
    this.setBalance(tokenId, to, newToBalance);
  }

  public mint(tokenId: TokenId, address: PublicKey, amount: Balance) {
    this.admin.assertIsSenderAdmin();
    const balance = this.getBalance(tokenId, address);
    const newBalance = balance.add(amount);
    this.setBalance(tokenId, address, newBalance);
  }

  @runtimeMethod()
  public mintAdmin(tokenId: TokenId, address: PublicKey, amount: Balance) {
    this.admin.assertIsSenderAdmin();
    this.mint(tokenId, address, amount);
  }

  @runtimeMethod()
  public burn(tokenId: TokenId, address: PublicKey, amount: Balance) {
    this.admin.assertIsSenderAdmin();
    const balance = this.getBalance(tokenId, address);

    const balanceIsSufficient = balance.greaterThanOrEqual(amount);
    assert(balanceIsSufficient, errors.burnBalanceInsufficient());

    const paddedBalance = Provable.if<UInt64>(
      balanceIsSufficient,
      UInt64,
      balance,
      balance.add(amount)
    );

    const newBalance = paddedBalance.sub(amount);

    this.setBalance(tokenId, address, newBalance);
  }

  @runtimeMethod()
  public transferSigned(
    tokenId: TokenId,
    from: PublicKey,
    to: PublicKey,
    amount: Balance
  ) {
    assert(this.transaction.sender.equals(from), errors.senderNotFrom());

    this.transfer(tokenId, from, to, amount);
  }
}
