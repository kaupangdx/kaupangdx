import { RuntimeModule, runtimeMethod, state } from "@proto-kit/module";
import { Option, State, assert } from "@proto-kit/protocol";
import { Bool, PublicKey } from "o1js";

export class Admin extends RuntimeModule<unknown> {
  @state() public admin = State.from<PublicKey>(PublicKey);

  @runtimeMethod()
  public setAdmin(newAdmin: PublicKey) {
    const [isSenderAdmin, admin] = this.isSenderAdmin();

    // allow setting only if empty, or if the sender is admin
    assert(
      admin.isSome.not().or(isSenderAdmin),
      "Sender is not admin, or the admin is not empty"
    );

    this.admin.set(newAdmin);
  }

  public isSenderAdmin(): [Bool, Option<PublicKey>] {
    const admin = this.admin.get();
    const isSenderAdmin = admin.isSome.and(
      this.transaction.sender.equals(admin.value)
    );

    return [isSenderAdmin, admin];
  }

  public assertIsSenderAdmin() {
    const [isSenderAdmin] = this.isSenderAdmin();
    assert(isSenderAdmin, "Sender is not admin");
  }
}
