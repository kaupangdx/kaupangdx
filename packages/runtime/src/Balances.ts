import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";
import { Field, Provable, PublicKey, Struct, UInt64 } from "o1js";
import { inject } from "tsyringe";
import { Admin } from "./Admin";

export const errors = {
  unauthorizedSender: () => "Unauthorized sender",
  insufficientBalance: () => "Insufficient balance",
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
    Balance,
  );

  @state() public supply = StateMap.from<TokenId, Balance>(TokenId, Balance);

  public constructor(@inject("Admin") public admin: Admin) {
    super();
  }

  public getSupply(token: TokenId): Balance {
    const supply = this.supply.get(token);
    return Provable.if(supply.isSome, Balance, supply.value, Balance.zero);
  }

  public getBalance(tokenId: TokenId, address: PublicKey): Balance {
    const key = new BalancesKey({ tokenId, address });
    const balanceOption = this.balances.get(key);

    return Provable.if(
      balanceOption.isSome,
      Balance,
      balanceOption.value,
      Balance.from(0),
    );
  }

  public setBalance(tokenId: TokenId, address: PublicKey, amount: Balance) {
    const key = new BalancesKey({ tokenId, address });
    this.balances.set(key, amount);
  }

  public _transfer(
    tokenId: TokenId,
    from: PublicKey,
    to: PublicKey,
    amount: Balance,
  ) {
    const fromBalance = this.getBalance(tokenId, from);
    const toBalance = this.getBalance(tokenId, to);
    const fromBalanceIsSufficient = fromBalance.greaterThanOrEqual(amount);

    // Assert balance sufficiency
    assert(fromBalanceIsSufficient, errors.insufficientBalance());

    // Field substraction underflow prevention
    const paddedFrombalance = fromBalance.add(amount);
    const safeFromBalance = Provable.if(
      fromBalanceIsSufficient,
      Balance,
      fromBalance,
      paddedFrombalance,
    );

    // Compute new balance values
    const newFromBalance = safeFromBalance.sub(amount);
    const newToBalance = toBalance.add(amount);

    // Set balances
    this.setBalance(tokenId, from, newFromBalance);
    this.setBalance(tokenId, to, newToBalance);
  }

  public mint(tokenId: TokenId, address: PublicKey, amount: Balance) {
    // Increase address' balance
    this.setBalance(
      tokenId,
      address,
      this.getBalance(tokenId, address).add(amount),
    );
    // Increase total supply
    this.supply.set(tokenId, this.getSupply(tokenId).add(amount));
  }

  @runtimeMethod()
  public mintAdmin(tokenId: TokenId, address: PublicKey, amount: Balance) {
    // Assert sender is admin
    this.admin.assertIsSenderAdmin();
    this.mint(tokenId, address, amount);
  }

  @runtimeMethod()
  public burn(tokenId: TokenId, amount: Balance) {
    const sender = this.transaction.sender;

    const balance = this.getBalance(tokenId, sender);
    const balanceIsSufficient = balance.greaterThanOrEqual(amount);

    const supply = this.getSupply(tokenId);
    const supplyIsSufficient = supply.greaterThanOrEqual(amount);

    // Assert balance sufficiency
    assert(balanceIsSufficient, errors.insufficientBalance());

    // Field substraction underflow prevention
    const paddedBalance = Provable.if(
      balanceIsSufficient,
      Balance,
      balance,
      balance.add(amount),
    );

    // Field substraction underflow prevention
    const paddedSupply = Provable.if(
      supplyIsSufficient,
      Balance,
      supply,
      supply.add(amount),
    );

    this.setBalance(tokenId, sender, paddedBalance.sub(amount));
    this.supply.set(tokenId, paddedSupply.sub(amount));
  }

  @runtimeMethod()
  public transfer(tokenId: TokenId, to: PublicKey, amount: Balance) {
    this._transfer(tokenId, this.transaction.sender, to, amount);
  }
}
