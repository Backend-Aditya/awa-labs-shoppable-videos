-- BillingCycle was never written to by any code path (no metering/overage
-- enforcement was ever implemented against it) — dead schema since it was
-- first added. Dropping it rather than leaving half-built billing
-- infrastructure that looks load-bearing but isn't.
DROP TABLE "BillingCycle";
