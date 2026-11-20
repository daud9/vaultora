.PHONY: verify web contract-test contract-build fmt

verify:
	pnpm run web:check
	cargo fmt --all -- --check
	cargo clippy --workspace --all-targets -- -D warnings
	cargo test --workspace
	cd contracts/document-registry && stellar contract build

web:
	pnpm --dir apps/web dev

contract-test:
	cargo test --workspace

contract-build:
	cd contracts/document-registry && stellar contract build

fmt:
	cargo fmt --all -- --check
