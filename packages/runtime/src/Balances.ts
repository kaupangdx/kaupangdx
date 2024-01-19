import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap } from "@proto-kit/protocol";
import { Field, Provable, PublicKey, Struct, UInt64, Bool } from "o1js";
import { inject } from "tsyringe";
import { Admin } from "./Admin";
import { SafeMath } from "./SafeMath";

export const errors = {
  unauthorizedSender: () => "Unauthorized sender"
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
      Balance.zero,
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

    // Set balances
    this.setBalance(tokenId, from, SafeMath.safeSub(fromBalance, amount, Bool(true)));
    this.setBalance(tokenId, to, toBalance.add(amount));
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
    const supply = this.getSupply(tokenId);

    this.setBalance(tokenId, sender, SafeMath.safeSub(balance, amount, Bool(true)));
    this.supply.set(tokenId, SafeMath.safeSub(supply, amount, Bool(true)));
  }

  @runtimeMethod()
  public transfer(tokenId: TokenId, to: PublicKey, amount: Balance) {
    this._transfer(tokenId, this.transaction.sender, to, amount);
  }
}
