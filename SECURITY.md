# Security Policy

MeterForge is a portfolio demonstration. It does not process live payments.

- Do not configure real Stripe keys.
- Demo organizations and usage quantities are synthetic.
- Idempotency is enforced in the domain layer so retries cannot silently double-count.
