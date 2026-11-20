import { useEffect, useReducer, useRef, useState } from "react";
import type { DragEvent, SVGProps } from "react";
import { sha256File, type HashedFile } from "./lib/fileHash";
import {
  defaultSorobanConfig,
  explorerTransactionUrl,
  type DocumentOperation,
} from "./lib/sorobanConfig";
import {
  initialTransactionState,
  transactionReducer,
} from "./lib/transactionState";
import {
  connectWallet,
  disconnectWallet,
  walletErrorMessage,
  type ConnectedWallet,
} from "./lib/wallet";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <Icon><path d="M12 3 19 6v5.4c0 4.5-2.9 7.6-7 9.6-4.1-2-7-5.1-7-9.6V6l7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>
    </div>
  );
}

function ArrowUpRight() { return <Icon className="icon-small"><path d="M7 17 17 7M7 7h10v10" /></Icon>; }
function CopyIcon() { return <Icon className="icon-small"><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" /></Icon>; }
function FileIcon() { return <Icon className="icon-medium"><path d="M13 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10Z" /><path d="M13 3v7h7M8 15h8M8 18h5" /></Icon>; }
function ShieldIcon() { return <Icon className="icon-medium"><path d="M12 3 19 6v5.4c0 4.5-2.9 7.6-7 9.6-4.1-2-7-5.1-7-9.6V6l7-3Z" /><path d="m9 12 2 2 4-4" /></Icon>; }
function ActivityIcon() { return <Icon className="icon-medium"><path d="M3 12h4l3-8 4 16 3-8h4" /></Icon>; }
function WalletIcon() { return <Icon className="icon-medium"><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H20v14H5.5A2.5 2.5 0 0 1 3 16.5Z" /><path d="M3 8h14a3 3 0 0 1 3 3v2h-4a2 2 0 0 0 0 4h4M16 13h.01" /></Icon>; }
function Chevron() { return <Icon className="icon-small"><path d="m9 18 6-6-6-6" /></Icon>; }

const navLinks = [
  { href: "#overview", label: "Overview", icon: <Icon><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /></Icon> },
  { href: "#documents", label: "Documents", icon: <FileIcon /> },
  { href: "#activity", label: "Activity", icon: <ActivityIcon /> },
];

const stageLabels = {
  preparing: "Preparing transaction",
  awaiting_authorization: "Awaiting wallet authorization",
  submitted: "Submitted to Testnet",
  confirmed: "Confirmed on Testnet",
  failed: "Transaction failed",
} as const;

function shortAddress(address: string): string {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function App() {
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [activeSection, setActiveSection] = useState("overview");
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletError, setWalletError] = useState("");
  const [fileResult, setFileResult] = useState<HashedFile | null>(null);
  const [fileError, setFileError] = useState("");
  const [hashing, setHashing] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [copied, setCopied] = useState(false);
  const [transaction, dispatchTransaction] = useReducer(transactionReducer, initialTransactionState);
  const [transactionNote, setTransactionNote] = useState("");
  const [activeOperation, setActiveOperation] = useState<DocumentOperation | null>(null);
  const [lastOperation, setLastOperation] = useState<DocumentOperation | null>(null);
  const [metadataDigest, setMetadataDigest] = useState("");
  const [verificationResult, setVerificationResult] = useState<
    | { digest: string; owner: string; found: boolean }
    | { digest: string; owner: string; error: string }
    | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const contractReady = Boolean(defaultSorobanConfig.contractId);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const sections = navLinks
      .map((link) => document.querySelector<HTMLElement>(link.href))
      .filter((section): section is HTMLElement => section !== null);
    const observer = new IntersectionObserver((entries) => {
      const visibleSection = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0];
      if (visibleSection) setActiveSection(visibleSection.target.id);
    }, { rootMargin: "-16% 0px -70% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, []);

  async function handleFile(file?: File) {
    setFileError("");
    setFileResult(null);
    setVerificationResult(null);
    setCopied(false);
    if (!file) {
      setFileError("Choose a file to calculate its digest.");
      return;
    }
    setHashing(true);
    try {
      const result = await sha256File(file);
      setFileResult(result);
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "Could not read this file.");
    } finally {
      setHashing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleConnect() {
    setWalletBusy(true);
    setWalletError("");
    try {
      setWallet(await connectWallet());
    } catch (error) {
      setWalletError(walletErrorMessage(error));
    } finally {
      setWalletBusy(false);
    }
  }

  async function handleDisconnect() {
    setWalletBusy(true);
    setWalletError("");
    try {
      await disconnectWallet();
      setWallet(null);
    } catch (error) {
      setWalletError(walletErrorMessage(error));
    } finally {
      setWalletBusy(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    void handleFile(event.dataTransfer.files[0]);
  }

  async function copyDigest() {
    if (!fileResult) return;
    try {
      await navigator.clipboard.writeText(fileResult.digest);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFileError("Clipboard access is unavailable. Select and copy the digest manually.");
    }
  }

  async function runContractOperation(operation: DocumentOperation) {
    if (!fileResult || !wallet || !contractReady || activeOperation) return;
    if (operation === "register" && !/^[a-f\d]{64}$/i.test(metadataDigest.trim())) return;
    if (operation === "register" && !wallet.network) {
      setWalletError("The wallet network could not be confirmed. Reconnect Varial before registering.");
      return;
    }
    if (operation === "register" && wallet.network?.networkPassphrase !== defaultSorobanConfig.networkPassphrase) {
      setWalletError("Your wallet is connected to a different network. Switch it to Testnet before registering.");
      return;
    }
    setWalletError("");
    setVerificationResult(null);
    if (operation === "register") {
      setTransactionNote("");
      dispatchTransaction({ type: "RESET" });
      dispatchTransaction({ type: "START" });
      setLastOperation("register");
    }
    setActiveOperation(operation);
    try {
      const { invokeDocumentContract } = await import("./lib/soroban");
      const result = await invokeDocumentContract({
        operation,
        digest: fileResult.digest,
        metadataDigest: operation === "register" ? metadataDigest.trim() : undefined,
        sourceAddress: wallet.address,
        config: defaultSorobanConfig,
        onStage: (stage, hash) => {
          if (stage === "preparing") dispatchTransaction({ type: "START" });
          if (stage === "awaiting_authorization") dispatchTransaction({ type: "REQUEST_AUTHORIZATION" });
          if (stage === "submitted" && hash) {
            dispatchTransaction({ type: "SUBMITTED", hash });
            setTransactionNote("Network accepted the transaction; waiting for ledger confirmation.");
          }
        },
      });
      if (result.kind === "verification") {
        setVerificationResult({ digest: fileResult.digest, owner: wallet.address, found: result.found });
        return;
      }
      if (result.confirmation === "confirmed") {
        dispatchTransaction({ type: "CONFIRMED" });
        setTransactionNote("The transaction is confirmed on Testnet.");
      } else {
        setTransactionNote(result.message || "Submitted; confirmation is still pending.");
      }
    } catch (error) {
      if (operation === "verify") {
        setVerificationResult({
          digest: fileResult.digest,
          owner: wallet.address,
          error: error instanceof Error ? error.message : "The read-only check failed.",
        });
      } else {
        const transactionHash =
          typeof error === "object" && error !== null && "transactionHash" in error &&
          typeof error.transactionHash === "string"
            ? error.transactionHash
            : undefined;
        dispatchTransaction({
          type: "FAILED",
          message: error instanceof Error ? error.message : "The contract operation failed.",
          hash: transactionHash,
        });
      }
    } finally {
      setActiveOperation(null);
    }
  }

  const expectedPassphrase = defaultSorobanConfig.networkPassphrase;
  const metadataDigestValid = /^[a-f\d]{64}$/i.test(metadataDigest.trim());
  const networkMismatch = Boolean(wallet?.network && wallet.network.networkPassphrase !== expectedPassphrase);
  const networkUnavailable = Boolean(wallet && !wallet.network);
  const transactionIsVisible = transaction.stage !== "idle";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a href="#overview" className="brand" aria-label="Vaultora home">
          <BrandMark />
          <span className="brand-name">vaultora<span className="brand-period">.</span></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navLinks.map((link) => (
            <a key={link.href} className={`nav-link${activeSection === link.href.slice(1) ? " selected" : ""}`} href={link.href} aria-current={activeSection === link.href.slice(1) ? "location" : undefined}>
              {link.icon}<span>{link.label}</span>{activeSection === link.href.slice(1) && <span className="nav-indicator" />}
            </a>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <div className="network-card">
          <div className="network-card-top"><span className="pulse-dot" /> TESTNET</div>
          <p>Public test network</p>
          <span className="network-caption">Stellar · Soroban RPC</span>
        </div>
        <div className="sidebar-footer"><span className="footer-mark">V</span><span>Vaultora</span><span className="version-tag">BETA</span></div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><Chevron /><strong>Overview</strong></div>
          <div className="topbar-actions">
            <div className="network-pill"><span className="pulse-dot" />TESTNET</div>
            {wallet ? (
              <button className="wallet-connected" onClick={() => void handleDisconnect()} disabled={walletBusy} aria-label={`Disconnect wallet ${shortAddress(wallet.address)}`}>
                <span className="wallet-state"><span className="wallet-orb"><span /></span><span>Connected</span></span>
                <span className="wallet-address">{shortAddress(wallet.address)}</span>
                <span className="wallet-menu-dot">Disconnect</span>
              </button>
            ) : (
              <button className="button button-primary connect-button" onClick={() => void handleConnect()} disabled={walletBusy}>
                {walletBusy ? <span className="button-spinner" /> : <span className="wallet-connect-icon"><Icon><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H20v14H5.5A2.5 2.5 0 0 1 3 16.5Z" /><path d="M3 8h14a3 3 0 0 1 3 3v2h-4a2 2 0 0 0 0 4h4" /><path d="M16 13h.01" /></Icon></span>}
                {walletBusy ? "Connecting" : "Connect wallet"}
              </button>
            )}
          </div>
        </header>

        <main className="content">
          <section id="overview" className="welcome-row">
            <div>
              <div className="eyebrow"><span className="eyebrow-rule" />DOCUMENT INTEGRITY</div>
              <h1>Check a document<span className="title-period">.</span></h1>
              <p className="welcome-copy">Create a SHA-256 fingerprint and check it against Stellar Testnet. Your file stays on this device.</p>
            </div>
            <div className="secure-chip"><span className="secure-icon"><ShieldIcon /></span><span><strong>File stays local</strong><small>No upload or cloud storage</small></span></div>
          </section>

          <section className="summary-grid" aria-label="Workspace overview">
            <article className="summary-card">
              <div className="summary-heading"><span>FILE HANDLING</span><span className="summary-icon indigo"><FileIcon /></span></div>
              <div className="summary-value">Local</div>
              <div className="summary-caption">No file list is saved</div>
            </article>
            <article className="summary-card">
              <div className="summary-heading"><span>STELLAR REGISTRY</span><span className="summary-icon mint"><ShieldIcon /></span></div>
              <div className="summary-value">{contractReady ? "Configured" : "Setup"}</div>
              <div className="summary-caption">{contractReady ? "Testnet contract" : "Contract ID required"}</div>
            </article>
            <article className="summary-card">
              <div className="summary-heading"><span>WALLET</span><span className="summary-icon amber"><WalletIcon /></span></div>
              <div className="summary-value">{wallet ? "Connected" : "Connect"}</div>
              <div className="summary-caption">{wallet ? shortAddress(wallet.address) : "Needed for registry actions"}</div>
            </article>
          </section>

          {walletError && <div className="inline-alert error-alert" role="alert"><span className="alert-symbol">!</span><span>{walletError}</span><button onClick={() => setWalletError("")} aria-label="Dismiss wallet message">×</button></div>}

          <div className="section-heading" id="documents">
            <div><div className="section-kicker">LOCAL CHECK</div><h2>Choose a document</h2></div>
            <div className="local-badge"><span className="local-lock"><Icon><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon></span>LOCAL ONLY</div>
          </div>

          <section className="document-workspace">
            <div
              className={`dropzone${dragActive ? " drag-active" : ""}${fileResult ? " has-file" : ""}`}
              onDragOver={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileInputRef}
                className="visually-hidden"
                type="file"
                aria-label="Choose document to hash locally"
                onChange={(event) => void handleFile(event.currentTarget.files?.[0])}
              />
              <div className="dropzone-icon"><FileIcon /></div>
              <div className="dropzone-copy">
                <h3>{fileResult ? "Digest ready" : "Drop a document here"}</h3>
                <p>{fileResult ? "Your file was read locally and was not uploaded." : "Calculate its SHA-256 fingerprint in your browser."}</p>
              </div>
              <button className="button button-secondary browse-button" onClick={() => fileInputRef.current?.click()} disabled={hashing}>
                {hashing ? <><span className="button-spinner dark-spinner" /> Hashing…</> : fileResult ? "Choose another file" : "Choose a file"}
              </button>
              <div className="dropzone-footnote"><span className="tiny-lock"><Icon><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon></span>File contents stay on this device. No upload or storage.</div>
            </div>

            <div className="digest-panel">
              <div className="digest-panel-heading"><div><div className="panel-kicker">FILE FINGERPRINT</div><h3>SHA-256 digest</h3></div><span className={`digest-status${fileResult ? " ready" : ""}`}><span className="digest-status-dot" />{fileResult ? "READY" : "WAITING"}</span></div>
              {fileError && <p className="field-error" role="alert">{fileError}</p>}
              {fileResult ? (
                <div className="digest-result">
                  <div className="file-meta"><span className="mini-file-icon"><FileIcon /></span><span className="filename" title={fileResult.fileName}>{fileResult.fileName}</span><span className="file-size">{formatBytes(fileResult.size)}</span></div>
                  <div className="digest-value-row"><code>{fileResult.digest}</code><button className="icon-button" onClick={() => void copyDigest()} aria-label="Copy digest" title="Copy digest"><CopyIcon /></button></div>
                  <div className="digest-hint">64 hexadecimal characters · SHA-256</div>
                  {copied && <div className="copy-feedback" role="status">Digest copied</div>}
                </div>
              ) : (
                <div className="digest-placeholder"><span className="placeholder-lock"><Icon><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon></span><span>Your digest will appear here</span></div>
              )}
              <div className="digest-divider" />
              <div className="onchain-row"><div className="onchain-copy"><span className="onchain-icon"><Icon><path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6 5.6 18.4" /></Icon></span><span><strong>Stellar Testnet</strong><small>{contractReady ? "Contract configured" : "Contract not configured"}</small></span></div><span className={`connection-light${contractReady ? " active" : ""}`} /></div>
            </div>
          </section>

          <section className="contract-section">
            <div className="contract-section-heading"><div><div className="panel-kicker">ON-CHAIN ACTIONS</div><h2>Registry operations</h2></div><span className="testnet-tag">TESTNET</span></div>
            {!contractReady && <div className="config-notice"><span className="notice-icon">i</span><span><strong>Contract unavailable</strong><br />Set <code>VITE_STELLAR_CONTRACT_ID</code> in <code>.env.local</code> after deploying the registry. No transaction can be created until it is configured.</span></div>}
            {networkMismatch && <div className="config-notice network-warning"><span className="notice-icon">!</span><span>Your wallet is on <strong>{wallet?.network?.network || "another network"}</strong>. Registration requires Testnet; read-only checks still query the configured Testnet RPC.</span></div>}
            {networkUnavailable && <div className="config-notice network-warning"><span className="notice-icon">!</span><span>The connected wallet's network could not be confirmed. Reconnect before registering; a read-only check does not request wallet authorization.</span></div>}
            <div className="operation-grid">
              <article className="operation-card">
                <div className="operation-number">01</div><div className="operation-title-row"><span className="operation-icon mint"><FileIcon /></span><h3>Register digest</h3></div>
                <p>Register this file's fingerprint and an encrypted-metadata fingerprint under your wallet address. The original file is never sent.</p>
                <label className="metadata-field" htmlFor="metadata-digest">
                  <span>Encrypted-metadata fingerprint <strong>Required</strong></span>
                  <input id="metadata-digest" value={metadataDigest} onChange={(event) => setMetadataDigest(event.currentTarget.value)} placeholder="64 hexadecimal characters" maxLength={64} autoCapitalize="none" spellCheck={false} aria-invalid={Boolean(metadataDigest) && !metadataDigestValid} />
                  <small>This version does not encrypt metadata. Enter its SHA-256 fingerprint if you already have one.</small>
                  {metadataDigest && !metadataDigestValid && <em>Enter exactly 64 hexadecimal characters.</em>}
                </label>
                <button className="button button-operation" disabled={!contractReady || !wallet || !fileResult || !metadataDigestValid || Boolean(activeOperation) || networkMismatch || networkUnavailable} onClick={() => void runContractOperation("register")}>
                  {activeOperation === "register" ? "Working…" : "Register on Testnet"}<ArrowUpRight />
                </button>
              </article>
              <article className="operation-card">
                <div className="operation-number">02</div><div className="operation-title-row"><span className="operation-icon violet"><ShieldIcon /></span><h3>Verify digest</h3></div>
                <p>Check whether this fingerprint is registered to your wallet. The read-only check does not ask for a signature.</p>
                <button className="button button-operation" disabled={!contractReady || !wallet || !fileResult || Boolean(activeOperation)} onClick={() => void runContractOperation("verify")}>
                  {activeOperation === "verify" ? "Checking…" : "Check registry (read-only)"}<ArrowUpRight />
                </button>
              </article>
            </div>
            {verificationResult && <div className={`verification-result${"error" in verificationResult ? " verification-error" : ""}`} role="status" aria-live="polite">
              <div><strong>{"error" in verificationResult ? "Read-only check failed" : verificationResult.found ? "Record found" : "No record found"}</strong>
                <p>{"error" in verificationResult ? verificationResult.error : `Checked ${shortAddress(verificationResult.owner)} against the configured registry.`}</p>
                <small>No transaction was submitted and no wallet authorization was requested. Fingerprint: <code>{verificationResult.digest}</code></small>
              </div>
            </div>}
            {!wallet && <div className="wallet-callout"><span className="wallet-callout-icon"><Icon><path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H20v14H5.5A2.5 2.5 0 0 1 3 16.5Z" /><path d="M3 8h14a3 3 0 0 1 3 3v2h-4a2 2 0 0 0 0 4h4" /><path d="M16 13h.01" /></Icon></span><span><strong>Connect a Stellar wallet</strong><small>Registration needs Testnet approval. Verification uses your public address and does not request a signature.</small></span><button className="text-button" onClick={() => void handleConnect()} disabled={walletBusy}>Connect <ArrowUpRight /></button></div>}
            {transactionIsVisible && <TransactionStatus state={transaction} note={transactionNote} operation={lastOperation} />}
          </section>

          <section className="activity-section" id="activity">
            <div className="activity-heading"><div><div className="panel-kicker">TESTNET</div><h2>Recent transactions</h2></div></div>
            {transaction.hash ? (
              <div className="activity-empty activity-record"><div className="activity-empty-mark"><ActivityIcon /></div><div><strong>{lastOperation === "register" ? "Digest registration" : "Digest verification"}</strong><p>{transaction.stage === "confirmed" ? "Confirmed on Stellar Testnet" : transaction.stage === "failed" ? "Transaction attempt failed" : "Submitted to Stellar Testnet"}</p></div><a className="activity-record-link" href={explorerTransactionUrl(transaction.hash)} target="_blank" rel="noreferrer">View transaction <ArrowUpRight /></a></div>
            ) : (
              <div className="activity-empty"><div className="activity-empty-mark"><ActivityIcon /></div><div><strong>No transactions yet</strong><p>Submitted registrations appear here during this session.</p></div></div>
            )}
          </section>

          <section className="foundation-section" id="foundation">
            <div className="activity-heading"><div><div className="panel-kicker">PRODUCT STATUS</div><h2>What is available</h2></div><span className="testnet-tag">EARLY VERSION</span></div>
            <div className="foundation-grid">
              <article className="foundation-card"><span className="foundation-status planned">PLANNED</span><h3>Project spaces</h3><p>Group related documents by project.</p></article>
              <article className="foundation-card"><span className="foundation-status planned">PLANNED</span><h3>Saved links</h3><p>Keep reference links beside your documents.</p></article>
              <article className="foundation-card"><span className="foundation-status active">AVAILABLE</span><h3>File integrity</h3><p>Hash files in your browser. The registry stores fingerprints and record details, not original files.</p></article>
              <article className="foundation-card"><span className="foundation-status planned">PLANNED</span><h3>Recovery</h3><p>Account recovery is under design. No recovery flow is available yet.</p></article>
              <article className="foundation-card"><span className="foundation-status planned">PLANNED</span><h3>Settings</h3><p>Network and contract settings are managed by the site deployment.</p></article>
            </div>
          </section>

          <footer className="app-footer"><span>Vaultora <span className="footer-separator">/</span> Document integrity workspace</span><span><span className="footer-dot" /> Files stay on your device</span></footer>
        </main>
      </div>
    </div>
  );
}

function TransactionStatus({ state, note, operation }: { state: ReturnType<typeof transactionReducer>; note: string; operation: DocumentOperation | null }) {
  if (state.stage === "idle") return null;
  const label = stageLabels[state.stage];
  const isFailed = state.stage === "failed";
  return (
    <section className={`transaction-status ${isFailed ? "transaction-failed" : ""}`} aria-live="polite" aria-label="Transaction status">
      <div className={`transaction-indicator ${isFailed ? "failed" : state.stage === "confirmed" ? "confirmed" : "pending"}`}>
        {state.stage === "confirmed" ? <Icon><path d="m5 12 4 4L19 6" /></Icon> : isFailed ? "!" : <span className="button-spinner dark-spinner" />}
      </div>
      <div className="transaction-body">
        <div className="transaction-topline"><strong>{label}</strong>{operation && <span>{operation === "register" ? "Register digest" : "Verify digest"}</span>}</div>
        <p>{isFailed ? "No successful contract execution was confirmed." : state.message || note || (state.stage === "awaiting_authorization" ? "Review the transaction details in your wallet." : "Preparing the on-chain request." )}</p>
        {state.hash && <div className="transaction-hash"><code>{state.hash}</code><a href={explorerTransactionUrl(state.hash)} target="_blank" rel="noreferrer">View on Stellar Expert <ArrowUpRight /></a></div>}
        {isFailed && <div className="transaction-error">{state.message}</div>}
      </div>
      {state.stage === "confirmed" && <span className="confirmed-tag">CONFIRMED</span>}
    </section>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1_048_576) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1_048_576).toFixed(1)} MB`;
}

export default App;
