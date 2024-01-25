import "reflect-metadata";
import {
  RuntimeModule,
  runtimeMethod,
  state,
  runtimeModule,
} from "@proto-kit/module";
import { StateMap, assert } from "@proto-kit/protocol";
import {
  Field,
  Group,
  Poseidon,
  Provable,
  PublicKey,
  Bool,
  Struct,
  UInt64,
} from "o1js";
import { Balance, Balances, TokenId } from "./Balances";
import { inject } from "tsyringe";
import { SafeMath } from "./SafeMath";

export class TokenPair extends Struct({
  tokenA: TokenId,
  tokenB: TokenId,
}) {
  public static from(tokenA: TokenId, tokenB: TokenId) {
    return Provable.if(
      tokenA.greaterThan(tokenB),
      TokenPair,
      new TokenPair({ tokenA: tokenA, tokenB: tokenB }),
      new TokenPair({ tokenA: tokenB, tokenB: tokenA }),
    );
  }
}

export class PoolKey extends PublicKey {
  public static fromTokenPair(tokenA: TokenId, tokenB: TokenId): PoolKey {
    const tokenPair = TokenPair.from(tokenA, tokenB);

    const {
      x,
      y: { x0 },
    } = Poseidon.hashToGroup(TokenPair.toFields(tokenPair));

    const key = PoolKey.fromGroup(Group.fromFields([x, x0]));

    return key;
  }
}

export class LPTokenId extends TokenId {
  public static fromTokenPair(tokenA: TokenId, tokenB: TokenId): TokenId {
    return TokenId.from(
      Poseidon.hash(TokenPair.toFields(TokenPair.from(tokenA, tokenB))),
    );
  }
}

export class WrappedPath extends Struct({
  path: Provable.Array(TokenId, 10),
}) {}

export const errors = {
  invalidPath: () => "Invalid path",
  insufficientBalances: () => "Insufficient balances",
  tokenASupplyIsZero: () => "Token A supply is zero",
  tokenBSupplyIsZero: () => "Token B supply is zero",
  insufficientAAmount: () => "Insufficient A amount",
  insufficientBAmount: () => "Insufficient B amount",
  insufficientAllowance: () => "Insufficient allowance",
  poolExists: () => "Pool already exists",
  poolDoesNotExist: () => "Pool does not exist",
  tokensMatch: () => "Cannot create pool with matching tokens",
  amountOutTooLow: () => "Token out amount too low",
  amountInTooHigh: () => "Token in amount too high",
  invalidMaxAmountIn: () => "Invalid max amount in value",
  invalidMinAmountOut: () => "Invalid min amount out value",
  invalidAmountIn: () => "Invalid amount in value",
  invalidAmountOut: () => "Invalid amount out value",
};

@runtimeModule()
export class XYK extends RuntimeModule<unknown> {
  public static defaultPoolValue = Field(0);
  @state() public pools = StateMap.from<PoolKey, Field>(PoolKey, Field);

  public constructor(@inject("Balances") public balances: Balances) {
    super();
  }

  public poolExists(tokenA: TokenId, tokenB: TokenId) {
    const key = PoolKey.fromTokenPair(tokenA, tokenB);
    const pool = this.pools.get(key);

    return pool.isSome;
  }

  public assertPoolExists(tokenA: TokenId, tokenB: TokenId) {
    assert(this.poolExists(tokenA, tokenB), errors.poolDoesNotExist());
  }

  @runtimeMethod()
  public createPool(
    tokenA: TokenId,
    tokenB: TokenId,
    tokenASupply: Balance,
    tokenBSupply: Balance,
  ) {
    assert(tokenA.equals(tokenB).not(), errors.tokensMatch());
    assert(this.poolExists(tokenA, tokenB).not(), errors.poolExists());

    assert(tokenASupply.greaterThan(UInt64.zero), errors.tokenASupplyIsZero());
    assert(tokenBSupply.greaterThan(UInt64.zero), errors.tokenBSupplyIsZero());

    const poolKey = PoolKey.fromTokenPair(tokenA, tokenB);
    this.pools.set(poolKey, XYK.defaultPoolValue);

    const creator = this.transaction.sender;

    this.balances._transfer(tokenA, creator, poolKey, tokenASupply);
    this.balances._transfer(tokenB, creator, poolKey, tokenBSupply);

    const lpToken = LPTokenId.fromTokenPair(tokenA, tokenB);
    const liquidity = Provable.if(
      tokenBSupply.greaterThan(tokenASupply),
      Balance,
      tokenASupply,
      tokenBSupply,
    );

    // Mint lp tokens to user
    this.balances.mint(lpToken, creator, liquidity);
  }

  @runtimeMethod()
  public addLiquidity(
    tokenA: TokenId,
    tokenB: TokenId,
    amountA: Balance,
    amountBMax: Balance,
  ) {
    this.assertPoolExists(tokenA, tokenB);
    const pool = PoolKey.fromTokenPair(tokenA, tokenB);

    assert(amountA.greaterThan(UInt64.zero));

    // Reserves cannot be zero due to pool creation and removal flow
    const reserveA = this.balances.getBalance(tokenA, pool);
    const reserveB = this.balances.getBalance(tokenB, pool);

    const amountB = SafeMath.safeDiv(
      amountA.mul(reserveB),
      reserveA,
      Bool(true),
    );
    assert(
      amountBMax.greaterThanOrEqual(amountB),
      errors.insufficientAllowance(),
    );

    const sender = this.transaction.sender;

    const senderBalanceA = this.balances.getBalance(tokenA, sender);
    const senderBalanceB = this.balances.getBalance(tokenB, sender);

    this.balances.setBalance(
      tokenA,
      sender,
      SafeMath.safeSub(senderBalanceA, amountA, Bool(true)),
    );
    this.balances.setBalance(
      tokenB,
      sender,
      SafeMath.safeSub(senderBalanceB, amountB, Bool(true)),
    );

    this.balances.setBalance(tokenA, pool, reserveA.add(amountA));
    this.balances.setBalance(tokenB, pool, reserveB.add(amountB));

    const lpToken = LPTokenId.fromTokenPair(tokenA, tokenB);
    const totalSupply = this.balances.getSupply(lpToken);

    const liqA = SafeMath.safeDiv(
      amountA.mul(totalSupply),
      reserveA,
      Bool(true),
    );
    const liqB = SafeMath.safeDiv(
      amountB.mul(totalSupply),
      reserveB,
      Bool(true),
    );

    const liquidity = Provable.if(liqB.greaterThan(liqA), Balance, liqA, liqB);

    assert(liquidity.greaterThan(Balance.zero), errors.insufficientBalances());

    this.balances.mint(lpToken, this.transaction.sender, liquidity);
  }

  @runtimeMethod()
  public removeLiquidity(
    tokenA: TokenId,
    tokenB: TokenId,
    liquidity: Balance,
    amountAMin: Balance,
    amountBMin: Balance,
  ) {
    this.assertPoolExists(tokenA, tokenB);
    const pool = PoolKey.fromTokenPair(tokenA, tokenB);

    // Burn the lp
    const lpToken = LPTokenId.fromTokenPair(tokenA, tokenB);

    // Get reserves
    const reserveA = this.balances.getBalance(tokenA, pool);
    const reserveB = this.balances.getBalance(tokenB, pool);

    const totalSupply = SafeMath.getSafeDenominator(
      this.balances.getSupply(lpToken),
      Bool(true),
    );

    const amountA = liquidity.mul(reserveA).div(totalSupply);
    const amountB = liquidity.mul(reserveB).div(totalSupply);

    assert(
      amountA.greaterThanOrEqual(amountAMin),
      errors.insufficientAAmount(),
    );
    assert(
      amountB.greaterThanOrEqual(amountBMin),
      errors.insufficientBAmount(),
    );

    const sender = this.transaction.sender;
    this.balances.setBalance(
      tokenA,
      sender,
      this.balances.getBalance(tokenA, sender).add(amountA),
    );
    this.balances.setBalance(
      tokenB,
      sender,
      this.balances.getBalance(tokenB, sender).add(amountB),
    );

    this.balances.setBalance(
      tokenA,
      pool,
      SafeMath.safeSub(reserveA, amountA, Bool(true)),
    );
    this.balances.setBalance(
      tokenB,
      pool,
      SafeMath.safeSub(reserveB, amountB, Bool(true)),
    );
    // Burn sender's lp tokens
    this.balances.burn(lpToken, liquidity);
    // TODO: Check if pool reserves are empty and delete the pool if so
  }

  public calculateTokenOutAmount(
    tokenIn: TokenId,
    tokenOut: TokenId,
    amountIn: Balance,
  ) {
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const reserveIn = this.balances.getBalance(tokenIn, pool);
    const reserveOut = this.balances.getBalance(tokenOut, pool);

    return this.calculateTokenOutAmountFromReserves(
      reserveIn,
      reserveOut,
      amountIn,
    );
  }

  public calculateTokenOutAmountFromReserves(
    reserveIn: Balance,
    reserveOut: Balance,
    amountIn: Balance,
  ) {
    const numerator = amountIn.mul(reserveOut);
    const denominator = reserveIn.add(amountIn);

    return SafeMath.safeDiv(numerator, denominator, Bool(true));
  }

  public calculateAmountIn(
    tokenIn: TokenId,
    tokenOut: TokenId,
    amountOut: Balance,
  ) {
    const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);

    const reserveIn = this.balances.getBalance(tokenIn, pool);
    const reserveOut = this.balances.getBalance(tokenOut, pool);

    return this.calculateAmountInFromReserves(reserveIn, reserveOut, amountOut);
  }

  public calculateAmountInFromReserves(
    reserveIn: Balance,
    reserveOut: Balance,
    amountOut: Balance,
  ) {
    const numerator = reserveIn.mul(amountOut);
    const denominator = SafeMath.safeSub(reserveOut, amountOut, Bool(true));
    return Provable.if(
      denominator.equals(Balance.zero),
      Balance,
      Balance.zero,
      SafeMath.safeDiv(numerator, denominator, Bool(false)),
    );
  }

  // 
  @runtimeMethod()
  public swapExactTokensForTokens(
    amountIn: Balance,
    minAmountOut: Balance,
    wrappedPath: WrappedPath,
  ) {
    assert(amountIn.greaterThan(Balance.zero), errors.invalidAmountIn());
    assert(
      minAmountOut.greaterThan(Balance.zero),
      errors.invalidMinAmountOut(),
    );

    const path = this.validateAndUnwrapPath(wrappedPath);

    let amountOut = Balance.zero;
    let lastPool = PoolKey.empty();
    let sender = this.transaction.sender;
    let lastTokenOut = TokenId.from(0);

  // First pair that we can find in the path when approaching from the last
  // index to the first, sends tokens to the transaction sender. Afterwards,
  // that pair becomes receiver and the pair before it sends tokens to it.
  // This operation is repeated until the beggining of the path has been reached.
  // Swap is closed outside of the loop when tokens are sent from transaction
  // sender to the first pool in the path.
    for (let i = 0; i < 9; i++) {
      const tokenIn = path[i];
      const tokenOut = path[i + 1];

      const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);
      const poolExists = this.pools.get(pool).isSome;

      lastTokenOut = Provable.if(poolExists, TokenId, tokenOut, lastTokenOut);

      lastPool = Provable.if(poolExists, PublicKey, pool, lastPool);

      amountOut = Provable.if(
        poolExists,
        Balance,
        this.calculateTokenOutAmount(tokenIn, tokenOut, amountIn),
        amountOut,
      );

      amountIn = Provable.if(poolExists, Balance, amountIn, Balance.zero);
      // Sending zero from last sender (pool or EOA) to the lastPool 
      // if pool for current pair does not exist.
      this.balances._transfer(tokenIn, sender, lastPool, amountIn);
      sender = lastPool;
      amountIn = amountOut;
    }
    assert(
      amountOut.greaterThanOrEqual(minAmountOut),
      errors.amountOutTooLow(),
    );
    // Closure of a swap with a transfer from last pool the initial sender
    this.balances._transfer(
      lastTokenOut,
      lastPool,
      this.transaction.sender,
      amountOut,
    );
  }

  // Transaction sender sends tokens to the first pair in the path.
  // Pairs then iteratively send tokens to each other until the end of the
  // path or until the empty slots of the path have been reached.
  // Last existing pair in the path will send tokens to the transaction
  // sender in order to close the swap.
  @runtimeMethod()
  public swapTokensForExactTokens(
    maxAmountIn: Balance,
    amountOut: Balance,
    wrappedPath: WrappedPath,
  ) {
    assert(maxAmountIn.greaterThan(Balance.zero), errors.invalidMaxAmountIn());
    assert(amountOut.greaterThan(Balance.zero), errors.invalidAmountOut());

    const path = this.validateAndUnwrapPath(wrappedPath);
    let receiver = this.transaction.sender;

    // Flow which iteratively swaps tokens in reverse across multiple pools
    // until the beggining of the path has been reached and amountIn is known
    // and lower than maxAmountIn.
    // Algorithm is adapted to the need of having a static sized loop.
    // We iterate over the path of 10 tokens (9 pools) in reverse and skip 
    // updating the values if the pool does not exist, because after the loop
    // we need to close the swap by sending tokens from the initial sender
    // to the first pool / receiver.
    for (let i = 9; i > 0; i--) {
      const tokenIn = path[i - 1];
      const tokenOut = path[i];

      const pool = PoolKey.fromTokenPair(tokenIn, tokenOut);
      const poolExists = this.pools.get(pool).isSome;

      const currentAmountOut = Provable.if(
        poolExists,
        Balance,
        amountOut,
        Balance.zero,
      );

      amountOut = Provable.if(
        poolExists,
        Balance,
        this.calculateAmountIn(tokenIn, tokenOut, currentAmountOut),
        amountOut,
      );

      this.balances._transfer(tokenOut, pool, receiver, currentAmountOut);
      receiver = Provable.if(poolExists, PublicKey, pool, receiver);
    }
    assert(amountOut.lessThanOrEqual(maxAmountIn), errors.amountInTooHigh());
    // Closure of a swap with a transfer from the initial sender to the first 
    // pool in an array.
    this.balances._transfer(
      path[0],
      this.transaction.sender,
      PoolKey.fromTokenPair(path[0], path[1]),
      amountOut,
    );
  }

  public validateAndUnwrapPath(wrappedPath: WrappedPath) {
    // Unwrap path
    const path: TokenId[] = wrappedPath.path;
    // Path must have the length of 10
    assert(
      UInt64.from(path.length).equals(UInt64.from(10)),
      errors.invalidPath(),
    );
    // Assert that path begins with a valid pool
    this.assertPoolExists(path[0], path[1]);

    return path;
  }
}
