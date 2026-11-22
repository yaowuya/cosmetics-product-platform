"""Bootstrap a single initial enterprise administrator without preset passwords."""
import argparse
import getpass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import hash_password
from app.db import engine
from app.models import Account


def create_first_admin(login: str, password: str) -> int:
    """Create the first governance-only account, or refuse an initialized database."""
    login = login.strip()
    if not login or len(login) > 190:
        raise ValueError("A nonempty login of at most 190 characters is required")
    encoded = hash_password(password)
    with Session(engine()) as db, db.begin():
        # An explicitly provisioned empty installation is the only bootstrap target.
        if db.scalar(select(Account.id).limit(1).with_for_update()) is not None:
            raise RuntimeError("Enterprise accounts are already initialized")
        account = Account(login=login, password_hash=encoded, can_manage=True)
        db.add(account)
        db.flush()
        return account.id


def main() -> None:
    """Accept a login, but read the temporary password only from hidden input."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("login")
    args = parser.parse_args()
    password = getpass.getpass("Temporary password: ")
    if password != getpass.getpass("Repeat temporary password: "):
        parser.exit(2, "Passwords do not match.\n")
    try:
        create_first_admin(args.login, password)
    except (ValueError, RuntimeError) as exc:
        parser.exit(2, f"{exc}\n")
    print("Administrator created; first login requires a password change.")


if __name__ == "__main__":
    main()
