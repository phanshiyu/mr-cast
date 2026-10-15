#!/usr/bin/env bash
# Fixture: schema migration + model + service change in a Python/SQLAlchemy billing app.
set -euo pipefail
dir="${1:?usage: invoice-status.sh <target-dir>}"
rm -rf "$dir" && mkdir -p "$dir" && cd "$dir"
git init -q -b main
git config user.email dev@ledgerly.example
git config user.name "Dana Whitfield"

mkdir -p app/models app/services app/api migrations/versions
cat > README.md <<'EOF'
# ledgerly-billing

Invoicing service for Ledgerly. Owns invoices, payments and the dunning schedule.

## Layout

- `app/models` SQLAlchemy models
- `app/services` business logic (invoice lifecycle, payments)
- `app/api` FastAPI routers
- `migrations` Alembic revisions

## Running

    pip install -e .
    alembic upgrade head
    uvicorn app.main:app
EOF
cat > app/models/invoice.py <<'EOF'
import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class InvoiceState(str, enum.Enum):
    DRAFT = "draft"
    OPEN = "open"
    PAID = "paid"
    VOID = "void"


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    number: Mapped[str] = mapped_column(String(32), unique=True)
    total_cents: Mapped[int] = mapped_column(Integer)
    state: Mapped[InvoiceState] = mapped_column(
        Enum(InvoiceState, name="invoice_state"), default=InvoiceState.DRAFT, index=True
    )
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    payments = relationship("Payment", back_populates="invoice", lazy="selectin")

    @property
    def paid_cents(self) -> int:
        return sum(p.amount_cents for p in self.payments if p.settled_at is not None)
EOF
cat > app/services/invoices.py <<'EOF'
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceState
from app.models.payment import Payment

TRANSITIONS: dict[InvoiceState, set[InvoiceState]] = {
    InvoiceState.DRAFT: {InvoiceState.OPEN, InvoiceState.VOID},
    InvoiceState.OPEN: {InvoiceState.PAID, InvoiceState.VOID},
    InvoiceState.PAID: set(),
    InvoiceState.VOID: set(),
}


class InvalidTransition(Exception):
    def __init__(self, current: InvoiceState, target: InvoiceState):
        super().__init__(f"cannot move invoice from {current.value} to {target.value}")
        self.current = current
        self.target = target


def transition(invoice: Invoice, target: InvoiceState) -> Invoice:
    if target not in TRANSITIONS[invoice.state]:
        raise InvalidTransition(invoice.state, target)
    invoice.state = target
    return invoice


def issue(db: Session, invoice: Invoice) -> Invoice:
    transition(invoice, InvoiceState.OPEN)
    invoice.issued_at = datetime.now(timezone.utc)
    db.add(invoice)
    return invoice


def apply_payment(db: Session, invoice: Invoice, amount_cents: int) -> Payment:
    payment = Payment(
        invoice_id=invoice.id,
        amount_cents=amount_cents,
        settled_at=datetime.now(timezone.utc),
    )
    db.add(payment)
    db.flush()
    db.refresh(invoice)
    if invoice.paid_cents >= invoice.total_cents:
        transition(invoice, InvoiceState.PAID)
    return payment


def void(db: Session, invoice: Invoice) -> Invoice:
    transition(invoice, InvoiceState.VOID)
    db.add(invoice)
    return invoice
EOF
cat > app/api/invoices.py <<'EOF'
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.models.invoice import Invoice
from app.services import invoices as svc

router = APIRouter(prefix="/invoices")


def serialize(invoice: Invoice) -> dict:
    return {
        "id": invoice.id,
        "number": invoice.number,
        "total_cents": invoice.total_cents,
        "paid_cents": invoice.paid_cents,
        "state": invoice.state.value,
        "due_at": invoice.due_at.isoformat() if invoice.due_at else None,
    }


@router.get("/{invoice_id}")
def get_invoice(invoice_id: int, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(404, "invoice not found")
    return serialize(invoice)


@router.post("/{invoice_id}/payments")
def pay(invoice_id: int, body: dict, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(404, "invoice not found")
    svc.apply_payment(db, invoice, int(body["amount_cents"]))
    db.commit()
    return serialize(invoice)


@router.post("/{invoice_id}/void")
def void_invoice(invoice_id: int, db: Session = Depends(get_db)):
    invoice = db.get(Invoice, invoice_id)
    if invoice is None:
        raise HTTPException(404, "invoice not found")
    try:
        svc.void(db, invoice)
    except svc.InvalidTransition as exc:
        raise HTTPException(409, str(exc))
    db.commit()
    return serialize(invoice)
EOF
cat > migrations/versions/0041_create_payments.py <<'EOF'
"""create payments

Revision ID: 0041
Revises: 0040
"""
import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"


def upgrade():
    op.create_table(
        "payments",
        sa.Column("id", sa.BigInteger, primary_key=True),
        sa.Column("invoice_id", sa.BigInteger, sa.ForeignKey("invoices.id"), nullable=False),
        sa.Column("amount_cents", sa.Integer, nullable=False),
        sa.Column("settled_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_payments_invoice_id", "payments", ["invoice_id"])


def downgrade():
    op.drop_table("payments")
EOF
git add -A && git commit -qm "Initial billing service"

git checkout -q -b feature/invoice-status
cat > app/models/invoice.py <<'EOF'
import enum
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class InvoiceState(str, enum.Enum):
    DRAFT = "draft"
    OPEN = "open"
    PAID = "paid"
    VOID = "void"


class InvoiceStatus(str, enum.Enum):
    DRAFT = "draft"
    OPEN = "open"
    PARTIALLY_PAID = "partially_paid"
    PAID = "paid"
    UNCOLLECTIBLE = "uncollectible"
    VOID = "void"


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    number: Mapped[str] = mapped_column(String(32), unique=True)
    total_cents: Mapped[int] = mapped_column(Integer)
    state: Mapped[InvoiceState] = mapped_column(
        Enum(InvoiceState, name="invoice_state"), default=InvoiceState.DRAFT, index=True
    )
    status: Mapped[InvoiceStatus | None] = mapped_column(
        Enum(InvoiceStatus, name="invoice_status"), nullable=True, index=True
    )
    issued_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow)

    payments = relationship("Payment", back_populates="invoice", lazy="selectin")

    @property
    def paid_cents(self) -> int:
        return sum(p.amount_cents for p in self.payments if p.settled_at is not None)

    @property
    def effective_status(self) -> InvoiceStatus:
        """Rows written before the backfill finishes have no status yet."""
        if self.status is not None:
            return self.status
        return InvoiceStatus(self.state.value)
EOF
cat > migrations/versions/0042_add_invoice_status.py <<'EOF'
"""add invoices.status with partial payments and uncollectible

Revision ID: 0042
Revises: 0041
"""
import sqlalchemy as sa
from alembic import op

revision = "0042"
down_revision = "0041"

invoice_status = sa.Enum(
    "draft",
    "open",
    "partially_paid",
    "paid",
    "uncollectible",
    "void",
    name="invoice_status",
)


def upgrade():
    invoice_status.create(op.get_bind(), checkfirst=True)
    op.add_column("invoices", sa.Column("status", invoice_status, nullable=True))

    op.execute(
        """
        UPDATE invoices i
        SET status = CASE
            WHEN i.state = 'void' THEN 'void'
            WHEN i.state = 'paid' THEN 'paid'
            WHEN i.state = 'draft' THEN 'draft'
            WHEN EXISTS (
                SELECT 1 FROM payments p
                WHERE p.invoice_id = i.id AND p.settled_at IS NOT NULL
            ) THEN 'partially_paid'
            ELSE 'open'
        END
        """
    )

    op.create_index("ix_invoices_status", "invoices", ["status"])


def downgrade():
    op.drop_index("ix_invoices_status", table_name="invoices")
    op.drop_column("invoices", "status")
    invoice_status.drop(op.get_bind(), checkfirst=True)
EOF
git add -A && git commit -qm "Add nullable invoices.status and backfill from state" 

cat > app/services/invoices.py <<'EOF'
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.invoice import Invoice, InvoiceState, InvoiceStatus
from app.models.payment import Payment

TRANSITIONS: dict[InvoiceStatus, set[InvoiceStatus]] = {
    InvoiceStatus.DRAFT: {InvoiceStatus.OPEN, InvoiceStatus.VOID},
    InvoiceStatus.OPEN: {
        InvoiceStatus.PARTIALLY_PAID,
        InvoiceStatus.PAID,
        InvoiceStatus.UNCOLLECTIBLE,
        InvoiceStatus.VOID,
    },
    InvoiceStatus.PARTIALLY_PAID: {InvoiceStatus.PAID, InvoiceStatus.UNCOLLECTIBLE},
    InvoiceStatus.UNCOLLECTIBLE: {InvoiceStatus.PAID},
    InvoiceStatus.PAID: set(),
    InvoiceStatus.VOID: set(),
}

# The legacy `state` column stays in sync until readers have moved to `status`.
LEGACY_STATE: dict[InvoiceStatus, InvoiceState] = {
    InvoiceStatus.DRAFT: InvoiceState.DRAFT,
    InvoiceStatus.OPEN: InvoiceState.OPEN,
    InvoiceStatus.PARTIALLY_PAID: InvoiceState.OPEN,
    InvoiceStatus.UNCOLLECTIBLE: InvoiceState.OPEN,
    InvoiceStatus.PAID: InvoiceState.PAID,
    InvoiceStatus.VOID: InvoiceState.VOID,
}


class InvalidTransition(Exception):
    def __init__(self, current: InvoiceStatus, target: InvoiceStatus):
        super().__init__(f"cannot move invoice from {current.value} to {target.value}")
        self.current = current
        self.target = target


def transition(invoice: Invoice, target: InvoiceStatus) -> Invoice:
    current = invoice.effective_status
    if target not in TRANSITIONS[current]:
        raise InvalidTransition(current, target)
    invoice.status = target
    invoice.state = LEGACY_STATE[target]
    return invoice


def issue(db: Session, invoice: Invoice) -> Invoice:
    transition(invoice, InvoiceStatus.OPEN)
    invoice.issued_at = datetime.now(timezone.utc)
    db.add(invoice)
    return invoice


def apply_payment(db: Session, invoice: Invoice, amount_cents: int) -> Payment:
    payment = Payment(
        invoice_id=invoice.id,
        amount_cents=amount_cents,
        settled_at=datetime.now(timezone.utc),
    )
    db.add(payment)
    db.flush()
    db.refresh(invoice)
    if invoice.paid_cents >= invoice.total_cents:
        transition(invoice, InvoiceStatus.PAID)
    elif invoice.effective_status == InvoiceStatus.OPEN:
        transition(invoice, InvoiceStatus.PARTIALLY_PAID)
    return payment


def mark_uncollectible(db: Session, invoice: Invoice) -> Invoice:
    transition(invoice, InvoiceStatus.UNCOLLECTIBLE)
    db.add(invoice)
    return invoice


def void(db: Session, invoice: Invoice) -> Invoice:
    transition(invoice, InvoiceStatus.VOID)
    db.add(invoice)
    return invoice
EOF
python3 - <<'EOF'
import re
p='app/api/invoices.py'
s=open(p).read()
s=s.replace('        "state": invoice.state.value,\n','        "state": invoice.state.value,\n        "status": invoice.effective_status.value,\n')
open(p,'w').write(s)
EOF
git add -A && git commit -qm "Drive invoice transitions from InvoiceStatus, add partially_paid and uncollectible"
echo "invoice-status repo ready at $dir (branch feature/invoice-status, base main)"
