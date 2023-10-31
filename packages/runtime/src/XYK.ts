import "reflect-metadata";
import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";

import { Field, Group, Poseidon, Provable, PublicKey, Struct } from "snarkyjs";
import { Balance, Balances, TokenId } from "./Balances";
import { inject } from "tsyringe";

export class TokenPair extends Struct({
  tokenInId: TokenId,
  tokenOutId: TokenId,
}) {
  public static from(tokenInId: TokenId, tokenOutId: TokenId) {
    return Provable.if(
      tokenInId.greaterThan(tokenOutId),
      TokenPair,
      new TokenPair({ tokenInId, tokenOutId }),
      new TokenPair({ tokenInId: tokenOutId, tokenOutId: tokenInId })
    );
  }
}

export class PoolKey extends PublicKey {
  public static fromTokenIdPair(
    tokenInId: TokenId,
    tokenOutId: TokenId
  ): PoolKey {
    const tokenPair = TokenPair.from(tokenInId, tokenOutId);

    const {
      x,
      y: { x0 },
    } = Poseidon.hashToGroup(TokenPair.toFields(tokenPair));

    const key = PoolKey.fromGroup(Group.fromFields([x, x0]));

    return key;
  }
}

export class LPTokenId extends TokenId {
  public static fromTokenIdPair(
    tokenInId: TokenId,
    tokenOutId: TokenId
  ): TokenId {
    return TokenId.from(
      Poseidon.hash(TokenPair.toFields(TokenPair.from(tokenInId, tokenOutId)))
    );
  }
}

export const errors = {
  poolExists: () => "Pool already exists",
  tokensMatch: () => "Cannot create pool with matching tokens",
  tokenOutAmountTooLow: () => "Token out amount too low",
  tokenInAmountTooHigh: () => "Token in amount too high",
};

@runtimeModule()
export class XYK extends RuntimeModule<unknown> {
  public static defaultPoolValue = Field(0);
  @state() public pools = StateMap.from<PoolKey, Field>(PoolKey, Field);

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

  public poolExists(tokenInId: TokenId, tokenOutId: TokenId) {
    const key = PoolKey.fromTokenIdPair(tokenInId, tokenOutId);
    const pool = this.pools.get(key);

    return pool.isSome;
  }

  @runtimeMethod()
  public createPool(
    tokenInId: TokenId,
    tokenOutId: TokenId,
    tokenInAmount: Balance,
    tokenOutAmount: Balance
  ) {
    assert(tokenInId.equals(tokenOutId).not(), errors.tokensMatch());
    assert(this.poolExists(tokenInId, tokenOutId).not(), errors.poolExists());

    const key = PoolKey.fromTokenIdPair(tokenInId, tokenOutId);
    this.pools.set(key, XYK.defaultPoolValue);

    const creator = this.transaction.sender;
    const pool = PoolKey.fromTokenIdPair(tokenInId, tokenOutId);

    this.balances.transfer(tokenInId, creator, pool, tokenInAmount);
    this.balances.transfer(tokenOutId, creator, pool, tokenOutAmount);

    const lpTokenId = LPTokenId.fromTokenIdPair(tokenInId, tokenOutId);
    this.balances.mint(lpTokenId, creator, tokenInAmount);
  }
}
